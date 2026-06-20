const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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

    // Core Collection Variables
    const lawyerCollection = db.collection('lawyer');
    const Service = db.collection('Service');
    const imageCollection = db.collection('images');


    app.post('/api/lawyer', async (request, response) => {
      try {
        const newLawyerData = request.body;
        const result = await lawyerCollection.insertOne(newLawyerData);
        response.status(201).send(result);
      } catch (routeError) {
        response.status(500).send({ error: "Failed to save lawyer data to database" });
      }
    });
    app.post('/api/images', async (request, response) => {
      try {
        // Destructure from request.body
        const { userId, imageUrl } = request.body;

        // Check if data arrived
        if (!userId || !imageUrl) {
          return response.status(400).send({ error: "Missing userId or imageUrl" });
        }

        const result = await imageCollection.insertOne({
          userId,
          imageUrl,
          uploadedAt: new Date()
        });

        response.status(201).send({ success: true, result });
      } catch (routeError) {
        console.error("Backend Error:", routeError);
        response.status(500).send({ error: "Failed to save image to database" });
      }
    });

    // --- GET IMAGE BY USERID ---
    app.get('/api/images/:userid', async (request, response) => {
      try {
        const targetUserId = request.params.userid;
        const image = await imageCollection.findOne({ userId: targetUserId });

        if (!image) {
          return response.status(404).json({ message: "No image found for this user." });
        }

        response.json(image);
      } catch (error) {
        console.error("Fetch Image Error:", error);
        response.status(500).json({ message: "Internal server error" });
      }
    });

    // --- UPDATE IMAGE BY USERID ---
    app.patch('/api/images/:userid', async (request, response) => {
      try {
        const targetUserId = request.params.userid;
        const { imageUrl } = request.body;

        if (!imageUrl) {
          return response.status(400).json({ message: "New image URL is required." });
        }

        const filter = { userId: targetUserId };
        const updateDoc = {
          $set: {
            imageUrl: imageUrl,
            updatedAt: new Date()
          }
        };

        const result = await imageCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return response.status(404).json({ message: "User image record not found." });
        }

        response.json({ message: "Image updated successfully", result });
      } catch (error) {
        console.error("Update Image Error:", error);
        response.status(500).json({ message: "Internal server error while updating" });
      }
    });

    // --- GET SINGLE LAWYER PROFILE BY USERID ---
    app.get('/api/lawyer/:userid', async (request, response) => {
      try {
        const targetUserId = request.params.userid;
        const query = {
          userId: targetUserId
        };

        const data = await lawyerCollection.findOne(query);

        if (!data) {
          return response.status(404).json({
            message: "Lawyer profile not found for the provided user ID."
          });
        }

        response.json(data);

      } catch (error) {
        console.error("Database Fetch Error:", error);
        response.status(500).json({
          message: "Internal server error"
        });
      }
    });
   //-- UPDATA LAWYER DATA -- 
    app.patch('/api/lawyer/:userid', async (request, response) => {
      try {
        const targetUserId = request.params.userid;
        const filter = { userId: targetUserId };
        const { name, email, specialization, bio, hourlyFee, currency, profileImg } = request.body;


        const updateDoc = {
          $set: {}
        };

        if (name !== undefined) updateDoc.$set.name = name;
        if (email !== undefined) updateDoc.$set.email = email;
        if (specialization !== undefined) updateDoc.$set.specialization = specialization;
        if (bio !== undefined) updateDoc.$set.bio = bio;
        if (hourlyFee !== undefined) updateDoc.$set.hourlyFee = hourlyFee;
        if (currency !== undefined) updateDoc.$set.currency = currency;
        if (profileImg !== undefined) updateDoc.$set.profileImg = profileImg;

        // Prevent hitting the database with an empty $set object if body is empty
        if (Object.keys(updateDoc.$set).length === 0) {
          return response.status(400).json({ message: "No modifiable fields provided." });
        }

        const result = await lawyerCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return response.status(404).json({
            message: "Lawyer profile not found for the provided user ID."
          });
        }

        response.json({
          message: "Profile updated successfully",
          result
        });

      } catch (error) {
        console.error("Database Update Error:", error);
        response.status(500).json({
          message: "Internal server error while updating profile"
        })
      }
    });

    app.post('/api/service', async (request, response) => {
      try {
        const newServiceData = request.body;
        const result = await Service.insertOne(newServiceData);
        response.status(201).send(result);
      } catch (routeError) {
        response.status(500).send({ error: "Failed to save lawyer Service data to database" });
      }
    });

    app.get('/api/collectawyer', async (request, response) => {
      try {
        const cursor = lawyerCollection.find();
        const result = await cursor.toArray();
        response.send(result);
      } catch (error) {
        response.status(500).send({ error: "Failed to fetch lawyers list" });
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