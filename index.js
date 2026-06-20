const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = 8080;

app.use(cors());
app.use(express.json()); 
require('dotenv').config();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    
    const db = client.db('LexVizo');
    // This is your MongoDB collection instance
    const lawyerCollection = db.collection('lawyer'); 

  
    app.post('/api/lawyer', async (request, response) => {
      try {
        const newLawyerData = request.body;
        const result = await lawyerCollection.insertOne(newLawyerData);
        response.status(201).send(result);
      } catch (routeError) {
        console.error("Error inserting lawyer profile:", routeError);
        response.status(500).send({ error: "Failed to save lawyer data to database" });
      }
    });

  } catch (dbError) {
    console.error("Database connection failure:", dbError);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});