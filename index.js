const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = 8080;

app.use(cors());
app.use(express.json());
require('dotenv').config();

// Base test route
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
    const db = client.db('LexVizo');

    // Collections
    const lawyerCollection = db.collection('lawyer');
    const Service = db.collection('Service');
    const imageCollection = db.collection('images');

    console.log("Successfully connected to MongoDB.");

    // --- LAWYER PROFILE ROUTES ---

    // Create a new lawyer profile
    app.post('/api/lawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.insertOne(request.body);
        response.status(201).send(result);
      } catch (error) {
        response.status(500).send({ error: "Failed to save lawyer profile." });
      }
    });

    // Get a specific lawyer profile by userId
    app.get('/api/lawyer/:userid', async (request, response) => {
      try {
        const data = await lawyerCollection.findOne({ userId: request.params.userid });
        if (!data) {
          return response.status(404).json({ message: "Lawyer profile not found." });
        }
        response.json(data);
      } catch (error) {
        response.status(500).json({ message: "Internal server error." });
      }
    });

    // Update fields on a lawyer profile by userId
    app.patch('/api/lawyer/:userid', async (request, response) => {
      try {
        const { name, email, specialization, bio, hourlyFee, currency, profileImg } = request.body;
        const updateDoc = { $set: {} };

        if (name !== undefined) updateDoc.$set.name = name;
        if (email !== undefined) updateDoc.$set.email = email;
        if (specialization !== undefined) updateDoc.$set.specialization = specialization;
        if (bio !== undefined) updateDoc.$set.bio = bio;
        if (hourlyFee !== undefined) updateDoc.$set.hourlyFee = hourlyFee;
        if (currency !== undefined) updateDoc.$set.currency = currency;
        if (profileImg !== undefined) updateDoc.$set.profileImg = profileImg;

        if (Object.keys(updateDoc.$set).length === 0) {
          return response.status(400).json({ message: "No modifiable fields provided." });
        }

        const result = await lawyerCollection.updateOne({ userId: request.params.userid }, updateDoc);
        if (result.matchedCount === 0) {
          return response.status(404).json({ message: "Lawyer profile not found." });
        }

        response.json({ message: "Profile updated successfully", result });
      } catch (error) {
        response.status(500).json({ message: "Internal server error while updating profile." });
      }
    });

    // Get all registered lawyer profiles
    app.get('/api/collectawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.find().toArray();
        response.send(result);
      } catch (error) {
        response.status(500).send({ error: "Failed to fetch lawyers list." });
      }
    });


    // --- IMAGE ROUTES ---

    // Save a new user image record
    app.post('/api/images', async (request, response) => {
      try {
        const { userId, imageUrl } = request.body;
        if (!userId || !imageUrl) {
          return response.status(400).send({ error: "Missing userId or imageUrl." });
        }

        const result = await imageCollection.insertOne({
          userId,
          imageUrl,
          uploadedAt: new Date()
        });
        response.status(201).send({ success: true, result });
      } catch (error) {
        response.status(500).send({ error: "Failed to save image." });
      }
    });

    // Find a user image record by userId
    app.get('/api/images/:userid', async (request, response) => {
      try {
        const image = await imageCollection.findOne({ userId: request.params.userid });
        if (!image) {
          return response.status(404).json({ message: "No image found for this user." });
        }
        response.json(image);
      } catch (error) {
        response.status(500).json({ message: "Internal server error." });
      }
    });

    // Update an image url record by userId
    app.patch('/api/images/:userid', async (request, response) => {
      try {
        const { imageUrl } = request.body;
        if (!imageUrl) {
          return response.status(400).json({ message: "New image URL is required." });
        }

        const result = await imageCollection.updateOne(
          { userId: request.params.userid },
          { $set: { imageUrl, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return response.status(404).json({ message: "User image record not found." });
        }
        response.json({ message: "Image updated successfully", result });
      } catch (error) {
        response.status(500).json({ message: "Internal server error." });
      }
    });


    // --- SERVICE CATALOG ROUTES ---

    // Get services filtered by a specific owner's query params (?userId=...)
    app.get('/api/service', async (request, response) => {
      try {
        const { userId } = request.query;
        if (!userId) {
          return response.status(400).send({ error: "userId query parameter is required." });
        }

        const results = await Service.find({ userId }).toArray();
        response.status(200).send(results);
      } catch (error) {
        response.status(500).send({ error: "Failed to retrieve service data." });
      }
    });

    // Create a new catalog service item
    app.post('/api/service', async (request, response) => {
      try {
        const { title, price, description, userId } = request.body;
        if (!title || !price || !userId) {
          return response.status(400).send({ error: "Title, price, and userId are required." });
        }

        const result = await Service.insertOne({
          title,
          price: Number(price),
          description,
          userId,
          createdAt: new Date()
        });
        response.status(201).send(result);
      } catch (error) {
        response.status(500).send({ error: "Failed to save service data." });
      }
    });

    // Update a service item (Validates that the authenticated userId owns the record)
    app.put('/api/service/:id', async (request, response) => {
      try {
        const { id } = request.params;
        const { title, price, description, userId } = request.body;

        if (!userId) {
          return response.status(401).send({ error: "Unauthorized. Missing user data." });
        }

        const result = await Service.updateOne(
          { _id: new ObjectId(id), userId: userId },
          { $set: { title, price: Number(price), description } }
        );

        if (result.matchedCount === 0) {
          return response.status(404).send({ error: "Service not found or unauthorized access." });
        }
        response.status(200).send(result);
      } catch (error) {
        response.status(500).send({ error: "Failed to update service parameters." });
      }
    });

    // Delete a service item (Using safe query parameters for structural reliability)
    app.delete('/api/service/:id', async (request, response) => {
      try {
        const { id } = request.params;
        const { userId } = request.query; // Shifted safely from body to query

        if (!userId) {
          return response.status(401).send({ error: "Unauthorized access." });
        }

        const result = await Service.deleteOne({
          _id: new ObjectId(id),
          userId: userId
        });

        if (result.deletedCount === 0) {
          return response.status(404).send({ error: "Service not found or unauthorized access." });
        }
        response.status(200).send({ message: "Service deleted successfully." });
      } catch (error) {
        response.status(500).send({ error: "Failed to remove service entity." });
      }
    });

  } catch (dbError) {
    console.error("Database initialization failed:", dbError);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server executing live on port ${port}`);
});