// Define a port for Heroku to listen to
const PORT = process.env.PORT || 5000;
express().listen(PORT, () => logInfo(`Listening on port ${PORT}.`));
