const express = require('express');

// Define a port for Heroku to listen to
const PORT = process.env.PORT || 5000;
express().listen(PORT, () => console.log(`Listening on port ${PORT}.`));
