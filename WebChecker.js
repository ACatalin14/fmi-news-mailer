require('dotenv').config();

const axios = require('axios');
const nodemailer = require("nodemailer");
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const { MongoClient, ServerApiVersion } = require('mongodb');

const ANNOUNCEMENTS_URL = 'https://fmi.unibuc.ro/category/anunturi-secretariat/';
const STUDIES_COMPLETION_URL = 'https://fmi.unibuc.ro/finalizare-studii/';
const START_DELAY = parseInt(Math.random() * 10 * 60 * 1000);

let mongoClient;
let checkedWebsites = [];

const secretaryAnnouncementsConfig = {
    subjectEng: 'Secretary Announcements',
    subjectRo: 'Anunturi Secretariat',
    url: ANNOUNCEMENTS_URL,
    mongoDomName: 'secretaryAnnouncements',
    websiteRemainsTheSame: domsHaveSameArticles,
    getMailContentHTML: getNewSecretaryArticles,
};

const studiesCompletionConfig = {
    subjectEng: 'Studies Completion',
    subjectRo: 'Finalizare Studii',
    url: STUDIES_COMPLETION_URL,
    mongoDomName: 'studiesCompletion',
    websiteRemainsTheSame: domsHaveSameParagraphs,
    getMailContentHTML: getNewParagraphsAndHeaders,
};


function logInfo(message) {
    const timestamp = '[' + new Date().toISOString().replace('T', ' ').slice(0, -5) + ']';
    console.log(timestamp, 'INFO ', message)
}

async function checkWebsite(websiteConfig, retryCount = 5) {
    logInfo(`Checking ${websiteConfig.subjectEng}...`);

    const currentDOM = await getWebsite(websiteConfig.url);
    let lastDOM = null;
    let getFromDbRetryCount = 5;

    while (lastDOM === null && getFromDbRetryCount > 0) {
        lastDOM = await getDomFromMongo(websiteConfig.mongoDomName);
        getFromDbRetryCount--;
    }

    if (lastDOM === null) {
        logInfo(`Could not fetch old DOM for ${websiteConfig.subjectEng}.`);
        if (retryCount > 0) {
            logInfo('Trying again in 10 seconds...');
            setTimeout(checkWebsite, 10 * 1000, websiteConfig, retryCount - 1);
        } else {
            logInfo('Hit the request limit. Trying again next time.');
            await afterDoneCheckingTheWebsite(websiteConfig);
        }
        return;
    }

    logInfo(`Successfully fetched old DOM for ${websiteConfig.mongoDomName}.`);

    if (currentDOM === null) {
        logInfo(`Could not fetch website's dom for ${websiteConfig.subjectEng}.`);
        if (retryCount > 0) {
            logInfo('Trying again in 10 seconds...');
            setTimeout(checkWebsite, 10 * 1000, websiteConfig, retryCount - 1);
        } {
            logInfo('Hit the request limit. Trying again next time.');
            await afterDoneCheckingTheWebsite(websiteConfig);
        }
        return;
    }

    if (websiteConfig.websiteRemainsTheSame(lastDOM, currentDOM)) {
        logInfo(`No updates detected for ${websiteConfig.subjectEng}. Checking next time.`);
        await afterDoneCheckingTheWebsite(websiteConfig);
        return;
    }

    logInfo(`Updates detected for ${websiteConfig.subjectEng}. Sending email notification and updating DB...`);

    const mailHtmlContent = websiteConfig.getMailContentHTML(lastDOM, currentDOM);

    await sendMail(websiteConfig.subjectRo, mailHtmlContent);

    try {
        await saveCurrentDomInDatabase(websiteConfig.mongoDomName, currentDOM);
        logInfo('Saved new Dom in database.')
    } catch (err) {
        logInfo(`Error occurred while saving the current DOM for ${websiteConfig.subjectEng}.`);
        console.error(err);
    } finally {
        await afterDoneCheckingTheWebsite(websiteConfig);
    }
}

async function afterDoneCheckingTheWebsite(websiteConfig) {
    checkedWebsites.push(websiteConfig.subjectEng);

    if (checkedWebsites.length === 2) {
        await mongoClient.close();
    }
}

async function getWebsite(url) {
    const response = await axios.get(url);

    if (response.status === 200) {
        logInfo(`Successfully received response from ${url}.`)
        return new JSDOM(response.data);
    }

    logInfo('Something went wrong. Received response status:', response.status);

    return null;
}

async function getDomFromMongo(domName) {

    const doms = mongoClient.db("fmi-news").collection("doms");

    try {
        const results = await doms.find({ name: domName }).toArray();
        return new JSDOM(results[0].dom);
    } catch (err) {
        console.error(`Error occurred while fetching DOM for ${domName} from database.`);
        return null;
    }
}

async function saveCurrentDomInDatabase(domName, dom) {
    const doms = mongoClient.db("fmi-news").collection("doms");

    await doms.updateOne(
        { name: domName },
        {
            $set: {
                dom: dom.window.document.documentElement.outerHTML,
                updatedAt: new Date()
            }
        }
    );
}

async function sendMail(subject, htmlContent) {

    let transporter = nodemailer.createTransport({
        service: 'yahoo',
        host: 'smtp.mail.yahoo.com',
        port: 465,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.SENDER_USERNAME,
            pass: process.env.SENDER_PASSWORD,
        },
        debug: false,
        logger: true,
    });

    try {
        await transporter.sendMail({
            from: `"FMI News"<${process.env.SENDER_USERNAME}>`,
            to: process.env.RECEIVERS_LIST,
            subject: subject,
            html: htmlContent,
        });
    } catch (err) {
        console.error(err);
    }
}

function domsHaveSameArticles(oldDom, newDom) {
    const oldArticles = Array.from(oldDom.window.document.querySelectorAll('article'));
    const newArticles = Array.from(newDom.window.document.querySelectorAll('article'));
    const oldArticleIds = oldArticles.map(article => article.id);
    const newArticleIds = newArticles.map(article => article.id);

    logInfo(oldArticleIds);
    logInfo(newArticleIds);

    return JSON.stringify(oldArticleIds) === JSON.stringify(newArticleIds);
}

function getNewSecretaryArticles(oldDom, newDom) {
    const oldArticles = oldDom.window.document.querySelectorAll('article');
    const newArticles = newDom.window.document.querySelectorAll('article');
    const oldArticleIds = Array.from(oldArticles).map(oldArticle => oldArticle.id);
    const diffNewArticlesHtml = Array.from(newArticles)
        .filter(article => !oldArticleIds.includes(article.id))
        .map(article => article.outerHTML);

    return diffNewArticlesHtml.join('\n');
}

function domsHaveSameParagraphs(oldDom, newDom) {
    const oldDomParagraphs = Array.from(oldDom.window.document.querySelectorAll('.entry-content p'));
    const newDomParagraphs = Array.from(newDom.window.document.querySelectorAll('.entry-content p'));

    if (oldDomParagraphs.length !== newDomParagraphs.length) {
        return false;
    }

    const oldParagraphsTexts = oldDomParagraphs.map(p => p.textContent);

    return newDomParagraphs.every(newP => oldParagraphsTexts.includes(newP.textContent));
}

function getNewParagraphsAndHeaders(oldDom, newDom) {
    const newFirstHeader = newDom.window.document.querySelector('.entry-content h2');
    let newDiffs = `<a href="${STUDIES_COMPLETION_URL}">` + newFirstHeader.outerHTML + '</a>';

    const oldDomParagraphs = Array.from(oldDom.window.document.querySelectorAll('.entry-content p'));
    const newDomParagraphs = Array.from(newDom.window.document.querySelectorAll('.entry-content p'));

    const oldParagraphsTexts = oldDomParagraphs.map(p => p.textContent);

    const newParagraphs = newDomParagraphs
        .filter(par => !oldParagraphsTexts.includes(par.textContent))
        .map(par => par.outerHTML);

    newDiffs += newParagraphs.join('\n');

    return newDiffs;
}

async function connectToMongoDb() {
    const user = process.env.MONGODB_USERNAME;
    const pass = process.env.MONGODB_PASSWORD;
    const uri = `mongodb+srv://${user}:${pass}@cluster-fmi-catalin-ana.vkaev.mongodb.net/fmi-news?retryWrites=true&w=majority`;

    mongoClient = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

    await mongoClient.connect();
}

async function main() {
    try {
        await connectToMongoDb();
        await checkWebsite(secretaryAnnouncementsConfig)
        await checkWebsite(studiesCompletionConfig);
    } catch (err) {
        console.error(err);
    }
}

// Start with a random delay (at most 10 mins)
setTimeout(main, 1000);
