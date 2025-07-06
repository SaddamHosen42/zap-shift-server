require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bejl412.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const database = client.db('parcelDeliveryDB');
        const parcelCollection = database.collection('parcels');



        //insert parcel
        app.post('/parcels', async (req, res) => {
            try {
                const parcel = req.body;
                const result = await parcelCollection.insertOne(parcel);
                res.send(result);
            } catch (error) {
                console.error('Error inserting parcel:', error);
                res.status(500).json({ error: 'Failed to insert parcel' });
            }
        });

        //all parcels or parcels by email,sorted by latest
        app.get('/parcels', async (req, res) => {
            try {
                const email = req.query.email;
                const query = {};
                // console.log('Querymail:',req.query);
                if (email) {
                    query.created_by = email;
                }


                const parcels = await parcelCollection.find(query).sort({ creation_date: -1 }).toArray();
                res.json(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).json({ error: 'Failed to fetch parcels' });
            }
        });




        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error

    }
}
run().catch(console.dir);



//sample route
app.get('/', (req, res) => {
    res.send('Welcome to the Zap Shift Server!');
});

//start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});