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
    const Comments = db.collection('comments');

    console.log("Successfully connected to MongoDB.");

    // --- LAWYER PROFILE ROUTES ---

    // Create a new lawyer profile
    app.post('/api/lawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.insertOne(request.body);
        response.status(201).json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to save lawyer profile." });
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
        response.json(result); // Standardized to .json()
      } catch (error) {
        response.status(500).json({ error: "Failed to fetch lawyers list." });
      }
    });


    // --- IMAGE ROUTES (WITH ATOMIC SYNC FIXES) ---

    // Save a new user image record & sync it automatically to the lawyer's profile
    app.post('/api/images', async (request, response) => {
      try {
        const { userId, imageUrl } = request.body;

        if (!userId || !imageUrl) {
          return response.status(400).json({ error: "Missing userId or imageUrl." });
        }

        // 1. Save to standalone image management collection
        const imageResult = await imageCollection.insertOne({
          userId,
          imageUrl,
          uploadedAt: new Date()
        });

        // 2. CRITICAL SYNC: Simultaneously update the lawyer profile if it already exists
        await lawyerCollection.updateOne(
          { userId: userId },
          { $set: { profileImg: imageUrl, imageUrl: imageUrl } }
        );

        return response.status(201).json({
          success: true,
          imageUrl: imageUrl,
          imageResult
        });

      } catch (error) {
        console.error("Database error:", error);
        return response.status(500).json({ error: "Failed to save image." });
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

    // Update an image url record by userId & sync to lawyer collection
    app.patch('/api/images/:userid', async (request, response) => {
      try {
        const { imageUrl } = request.body;
        const { userid } = request.params;

        if (!imageUrl) {
          return response.status(400).json({ message: "New image URL is required." });
        }

        const imageResult = await imageCollection.updateOne(
          { userId: userid },
          { $set: { imageUrl, updatedAt: new Date() } }
        );

        if (imageResult.matchedCount === 0) {
          return response.status(404).json({ message: "User image record not found." });
        }

        // CRITICAL SYNC: Keep the lawyer profile matching the updated image
        await lawyerCollection.updateOne(
          { userId: userid },
          { $set: { profileImg: imageUrl, imageUrl: imageUrl } }
        );

        response.json({ message: "Image updated successfully across database collections.", imageResult });
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
          return response.status(400).json({ error: "userId query parameter is required." });
        }

        const results = await Service.find({ userId }).toArray();
        response.status(200).json(results);
      } catch (error) {
        response.status(500).json({ error: "Failed to retrieve service data." });
      }
    });

    // Create a new catalog service item
    app.post('/api/service', async (request, response) => {
      try {
        const { title, price, description, userId } = request.body;
        if (!title || !price || !userId) {
          return response.status(400).json({ error: "Title, price, and userId are required." });
        }

        const result = await Service.insertOne({
          title,
          price: Number(price),
          description,
          userId,
          createdAt: new Date()
        });
        response.status(201).json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to save service data." });
      }
    });

    // Update a service item 
    app.put('/api/service/:id', async (request, response) => {
      try {
        const { id } = request.params;
        const { title, price, description, userId } = request.body;

        if (!userId) {
          return response.status(401).json({ error: "Unauthorized. Missing user data." });
        }

        const result = await Service.updateOne(
          { _id: new ObjectId(id), userId: userId },
          { $set: { title, price: Number(price), description } }
        );

        if (result.matchedCount === 0) {
          return response.status(404).json({ error: "Service not found or unauthorized access." });
        }
        response.status(200).json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to update service parameters." });
      }
    });

    // Delete a service item 
    app.delete('/api/service/:id', async (request, response) => {
      try {
        const { id } = request.params;

        const result = await Service.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return response.status(404).json({ error: "Service not found or unauthorized access." });
        }
        response.status(200).json({ message: "Service deleted successfully." });
      } catch (error) {
        response.status(500).json({ error: "Failed to remove service entity." });
      }
    });


    // --- USER COMMENTS SECTION --- 
    app.post('/api/comments', async (request, response) => {
      try {
        const { author, role, rating, text, lawyerId, userId } = request.body;

        // 1. Strict validation check for mandatory protocol variables
        if (!author || !rating || !text || !lawyerId || !userId) {
          return response.status(400).json({
            error: "Author, rating, text, lawyerId, and userId are required variables."
          });
        }

        // 2. FIXED: Changed 'Image' to the correctly defined 'imageCollection' reference
        const imageRecord = await imageCollection.findOne({ userId: userId });

        // Extract the matching imageUrl string, or default to an empty string if not uploaded yet
        const userImage = imageRecord?.imageUrl || "";

        // 3. Insert structured payload with the correctly resolved image link
        const commentPayload = {
          author,
          role: role || "client",
          rating: Number(rating),
          text,
          lawyerId,
          userId,
          userImage,
          date: new Date().toISOString().split('T')[0],
          createdAt: new Date()
        };

        // 4. FIXED: Changed 'Comment' to the correctly defined 'Comments' reference
        const result = await Comments.insertOne(commentPayload);

        // 5. Return complete record matching your frontend state matrix expectations
        response.status(201).json({
          _id: result.insertedId,
          ...commentPayload
        });
      } catch (error) {
        
        console.error("Database write execution failure details:", error);
        response.status(500).json({ error: "Failed to save secure comment briefing data." });
      }
    });
    // --- GET COMMENTS WITH LAWYER DETAILS ---
    app.get('/api/comments', async (request, response) => {
      try {
        const { lawyerId } = request.query;

      
        const matchStage = {};
        if (lawyerId) {
          matchStage.lawyerId = lawyerId;
        }

     
        const commentsWithLawyers = await Comments.aggregate([
          { $match: matchStage },
          {
            $lookup: {
              from: 'lawyer',          
              foreignField: '_id',    
              as: 'lawyerDetails'      
            }
          },
         
          {
            $unwind: {
              path: '$lawyerDetails',
              preserveNullAndEmptyArrays: true 
            }
          },
         
          { $sort: { createdAt: -1 } }
        ]).toArray();

        response.status(200).json(commentsWithLawyers);
      } catch (error) {
        console.error("Aggregation lookup failure:", error);
        response.status(500).json({ error: "Failed to retrieve compiled evaluation records." });
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