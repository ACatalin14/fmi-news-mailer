require('dotenv').config();

const axios = require('axios');
const express = require('express');
const nodemailer = require("nodemailer");
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const ANNOUNCEMENTS_URL = 'https://fmi.unibuc.ro/category/anunturi-secretariat/';
const STUDIES_COMPLETION_URL = 'https://fmi.unibuc.ro/finalizare-studii/';
const HALF_DAY = 12 * 60 * 60 * 1000;
const HALF_HOUR = 30 * 60 * 1000;

const secretaryAnnouncementsConfig = {
    subjectEng: 'Secretary Announcements',
    subjectRo: 'Anunturi Secretariat',
    url: ANNOUNCEMENTS_URL,
    lastDOM: '',
    websiteRemainsTheSame: domsHaveSameArticles,
    getMailContentHTML: getNewSecretaryArticles,
};

const studiesCompletionConfig = {
    subjectEng: 'Studies Completion',
    subjectRo: 'Finalizare Studii',
    url: STUDIES_COMPLETION_URL,
    lastDOM: '',
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

    if (!currentDOM && retryCount > 0) {
        setTimeout(checkWebsite, HALF_HOUR, retryCount - 1);
        return;
    }

    if (!currentDOM && !retryCount) {
        logInfo('Hit the request limit. Trying again next time.');
        return;
    }

    if (websiteConfig.websiteRemainsTheSame(websiteConfig.lastDOM, currentDOM)) {
        logInfo('No updates detected. Checking next time.');
        return;
    }

    logInfo('Updates detected. Sending email notification...');

    const mailHtmlContent = websiteConfig.getMailContentHTML(websiteConfig.lastDOM, currentDOM);

    websiteConfig.lastDOM = currentDOM;

    await sendMail(websiteConfig.subjectRo, mailHtmlContent);
}

async function getWebsite(url) {
    const response = await axios.get(url);

    if (response.status === 200) {
        logInfo('Successfully received response.')
        return new JSDOM(response.data);
    }

    logInfo('Something went wrong. Received response status:', response.status);

    return null;
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
    const oldArticles = oldDom.window.document.querySelectorAll('article');
    const newArticles = newDom.window.document.querySelectorAll('article');

    return JSON.stringify(oldArticles) === JSON.stringify(newArticles);
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
    const newFirstHeader = oldDom.window.document.querySelector('.entry-content h2');
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


async function main() {

    const initialAnnouncements = await getWebsite(ANNOUNCEMENTS_URL);
    secretaryAnnouncementsConfig.lastDOM = new JSDOM(initialAnnouncements);
    setInterval(checkWebsite, HALF_DAY, secretaryAnnouncementsConfig);

    const initialCompletionStudies = await getWebsite(STUDIES_COMPLETION_URL);
    studiesCompletionConfig.lastDOM = new JSDOM(initialCompletionStudies);
    setInterval(checkWebsite, HALF_DAY, studiesCompletionConfig);

    setInterval(sendMail, 5 * 60 * 1000, 'Test', 'This is a <strong>test</strong>');
}

main();

// Define a port for Heroku to work on
const PORT = process.env.PORT || 5000;
express().listen(PORT, () => logInfo(`Listening on port ${PORT}.`));
