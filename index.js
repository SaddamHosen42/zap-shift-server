require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Ensure you have set your Stripe secret key in .env

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());



const serviceAccount = require("./profast-firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


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
        const usersCollection = database.collection('users');
        const parcelCollection = database.collection('parcels');
        const paymentCollection = database.collection('payments');
        const ridersCollection = database.collection('riders');

        //coustom middleware to check Firebase authentication
        const verifyJWT = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).send({ message: 'Unauthorized access' });
            }
            const token = authHeader.split(' ')[1];
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                res.status(401).send({ message: 'Unauthorized access' });
            }
        }

        const verifyEmail = (req, res, next) => {
            if (req.query.email !== req.decoded.email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            next();
        }
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        //API

        //search users by email
        app.get("/users/search", verifyJWT, verifyAdmin, async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Missing email query" });
            }
            const regex = new RegExp(emailQuery, "i"); // case-insensitive partial match

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(10)
                    .toArray();
                res.send(users);
            } catch (error) {
                console.error("Error searching users", error);
                res.status(500).send({ message: "Error searching users" });
            }
        });

        //get user role by email
        app.get('/users/:email/role', verifyJWT, async (req, res) => {
            try {
                const email = req.params.email;
                if (!email) {
                    return res.status(400).send({ message: 'Email is required' });
                }
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }
                res.send({ role: user.role || 'user' });
            } catch (error) {
                console.error('Error getting user role:', error);
                res.status(500).send({ message: 'Failed to get role' });
            }
        });

        // Create a new user
        app.post('/users', async (req, res) => {
            try {
                const email = req.body.email;
                const userExists = await usersCollection.findOne({ email });
                if (userExists) {
                    //update last login
                    const updateResult = await usersCollection.updateOne(
                        { email: email },
                        {
                            $set: {
                                last_log_in: new Date().toISOString() // Store the date as a string
                            }
                        }
                    );
                    if (updateResult.modifiedCount === 0) {
                        return res.status(500).json({ error: 'Failed to update last login' });
                    }
                    return res.status(200).json({ message: 'User already exists', inserted: false });
                }
                const user = req.body;
                const result = await usersCollection.insertOne(user);
                res.send(result);

            } catch (error) {
                console.error('Error inserting user:', error);
                res.status(500).json({ error: 'Failed to insert user' });
            }
        });

        //update user role
        app.patch("/users/:id/role", verifyJWT, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            if (!["admin", "user"].includes(role)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send({ message: `User role updated to ${role}`, result });
            } catch (error) {
                console.error("Error updating user role", error);
                res.status(500).send({ message: "Failed to update user role" });
            }
        });

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

        //Get all parcels or parcels by email,sorted by latest
        app.get('/parcels', verifyJWT, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let query = {}
                if (email) {
                    query = { created_by: email }
                }

                if (payment_status) {
                    query.payment_status = payment_status
                }

                if (delivery_status) {
                    query.delivery_status = delivery_status
                }

                const options = {
                    sort: { createdAt: -1 }, // Newest first
                };

                console.log('parcel query', req.query, query)

                const parcels = await parcelCollection.find(query, options).toArray();
                res.send(parcels);
            } catch (error) {
                console.error('Error fetching parcels:', error);
                res.status(500).send({ message: 'Failed to get parcels' });
            }
        });

        //get parcel by id
        app.get('/parcels/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const parcel = await parcelCollection.findOne(query);
                if (!parcel) {
                    return res.status(404).json({ error: 'Parcel not found' });
                }
                res.send(parcel);
            } catch (error) {
                console.error('Error fetching parcel:', error);
                res.status(500).json({ error: 'Failed to fetch parcel' });
            }
        });

        
        app.patch("/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName } = req.body;

            try {
                // Update parcel
                await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "in_transit",
                            assigned_rider_id: riderId,
                            assigned_rider_name: riderName,
                        },
                    }
                );

                // Update rider
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: "in_delivery",
                        },
                    }
                );

                res.send({ message: "Rider assigned" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });

        //delete parcel by id
        app.delete('/parcels/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await parcelCollection.deleteOne(query);
                res.send(result);
            } catch (error) {
                console.error('Error deleting parcel:', error);
                res.status(500).json({ error: 'Failed to delete parcel' });
            }
        });

        // POST: Add new rider
        app.post('/riders', async (req, res) => {
            try {
                const rider = req.body;
                const result = await ridersCollection.insertOne(rider);
                res.send(result);
            } catch (error) {
                console.error("❌ Failed to add rider:", error);
                res.status(500).send({ message: "Failed to add rider" });
            }
        });

        // GET: All pending riders
        app.get("/riders/pending", verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection
                    .find({ status: "pending" })
                    .toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error("❌ Failed to load pending riders:", error);
                res.status(500).send({ message: "Failed to load pending riders" });
            }
        });

        // GET: All active riders
        app.get("/riders/active", verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const result = await ridersCollection.find({ status: "active" }).toArray();
                res.send(result);
            } catch (error) {
                console.error("❌ Failed to load active riders:", error);
                res.status(500).send({ message: "Failed to load active riders" });
            }
        });

        // PATCH: Update rider status
        app.patch("/riders/:id/status", verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { status, email } = req.body;

                const query = { _id: new ObjectId(id) };
                const updateDoc = { $set: { status } };

                const result = await ridersCollection.updateOne(query, updateDoc);
                //update user role for accpeting rider
                if (status === 'active') {
                    await usersCollection.updateOne(
                        { email: email },
                        { $set: { role: 'rider' } }
                    );
                }
                res.send(result);
            } catch (error) {
                console.error("❌ Failed to update rider status:", error);
                res.status(500).send({ message: "Failed to update rider status" });
            }
        });

        // GET: abilable riders
        app.get("/riders/available", async (req, res) => {
            const { district } = req.query;

            try {
                const riders = await ridersCollection
                    .find({
                        district,
                        // status: { $in: ["approved", "active"] },
                        // work_status: "available",
                    })
                    .toArray();

                res.send(riders);
            } catch (err) {
                res.status(500).send({ message: "Failed to load riders" });
            }
        });






        // POST: Add tracking log
        app.post("/tracking", async (req, res) => {
            try {
                const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

                const log = {
                    tracking_id,
                    parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                    status,
                    message,
                    time: new Date(),
                    updated_by,
                };

                const result = await trackingCollection.insertOne(log);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                console.error("❌ Failed to add tracking log:", error);
                res.status(500).send({ message: "Failed to add tracking log" });
            }
        });




        //payment intent
        app.post('/create-payment-intent', async (req, res) => {

            const amountInCents = req.body.amountInCents;
            try {
                const paymentIntent = await Stripe.paymentIntents.create({
                    amount: amountInCents, // Amount in cents
                    currency: 'usd', // Currency code
                    payment_method_types: ['card'], // Specify the payment method types you want to accept
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                console.error('Error creating payment intent:', error);
                res.status(500).json({ error: 'Failed to create payment intent' });
            }
        })


        //post payments
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, amount, paymentMethodId, email, transactionId } = req.body;
                //update parcel status to paid
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );
                if (updateResult.modifiedCount === 0) {
                    return res.status(404).json({ error: 'Parcel not found or already paid' });
                }
                //insert payment details
                const paymentDoc = {
                    parcelId,
                    amount,
                    paymentMethodId,
                    email,
                    transactionId,
                    paid_at_string: new Date().toISOString(), // Store the date as a string
                    paid_at: new Date(), // Store the date as a Date object
                };
                const paymentResult = await paymentCollection.insertOne(paymentDoc);
                res.json({ success: true, paymentId: paymentResult.insertedId });

            } catch (error) {
                console.error('Error processing payment:', error);
                res.status(500).json({ error: 'Failed to process payment' });
            }
        })


        // Get all payments or payments by email
        app.get('/payments', verifyJWT, verifyEmail, async (req, res) => {
            try {
                const email = req.query.email;
                const query = {};
                if (email) {
                    query.email = email;
                }
                const payments = await paymentCollection.find(query).toArray();
                res.json(payments);
            } catch (error) {
                console.error('Error fetching payments:', error);
                res.status(500).json({ error: 'Failed to fetch payments' });
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