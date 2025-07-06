require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());




//sample route
app.get('/', (req, res) => {
  res.send('Welcome to the Zap Shift Server!');
});

//start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});