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
    const Users = db.collection('user');
    const lawyerCollection = db.collection('lawyer');
    const Service = db.collection('Service');
    const imageCollection = db.collection('images');
    const Comments = db.collection('comments');
    const HireRequest = db.collection('Hireing');

    console.log("Successfully connected to MongoDB.");


    // --- USER ACTIONS ------
    app.put('/api/user/:userid', async (req, res) => {
      try {
        const { userid } = req.params;
        // We can accept fullName from the frontend body...
        const { fullName } = req.body;

        // 1. Guard check for invalid MongoDB IDs
        if (!ObjectId.isValid(userid)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid user ID format.'
          });
        }

        // 2. Guard check to make sure a name was actually passed
        if (!fullName || fullName.trim() === "") {
          return res.status(400).json({
            success: false,
            message: 'A valid name parameter is required.'
          });
        }

        // 3. Update the correct document entry ('name' instead of 'fullName')
        const updateResult = await Users.findOneAndUpdate(
          { _id: new ObjectId(userid) },
          { $set: { name: fullName.trim() } }, // <-- CHANGED THIS to 'name' to target the auth field
          {
            returnDocument: 'after',
            projection: { password: 0 }
          }
        );

        if (!updateResult) {
          return res.status(404).json({
            success: false,
            message: 'User matching that ID was not found.'
          });
        }

        // --- Format the return object for your React UI state pipeline ---
        // If your React UI state expects a 'fullName' key returned in data, map it here:
        const responseData = {
          ...updateResult,
          fullName: updateResult.name // Ensures your client-side `updatedData.fullName` won't break
        };

        return res.status(200).json({
          success: true,
          message: 'User name updated successfully!',
          data: responseData
        });

      } catch (error) {
        console.error('Error updating name:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal Server Error. Could not handle data update.'
        });
      }
    });


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
        // 1. Add isBusy to your destructured parameters
        const { name, email, specialization, bio, hourlyFee, currency, profileImg, isBusy } = request.body;
        const updateDoc = { $set: {} };

        if (name !== undefined) updateDoc.$set.name = name;
        if (email !== undefined) updateDoc.$set.email = email;
        if (specialization !== undefined) updateDoc.$set.specialization = specialization;
        if (bio !== undefined) updateDoc.$set.bio = bio;
        if (hourlyFee !== undefined) updateDoc.$set.hourlyFee = hourlyFee;
        if (currency !== undefined) updateDoc.$set.currency = currency;
        if (profileImg !== undefined) updateDoc.$set.profileImg = profileImg;

        // 2. Append isBusy validation to the Mongo $set pipeline
        if (isBusy !== undefined) {
          // Cast explicitly to boolean just in case an odd payload makes through
          updateDoc.$set.isBusy = isBusy === true || isBusy === "true";
        }

        if (Object.keys(updateDoc.$set).length === 0) {
          return response.status(400).json({ message: "No modifiable fields provided." });
        }

        const result = await lawyerCollection.updateOne({ userId: request.params.userid }, updateDoc);
        if (result.matchedCount === 0) {
          return response.status(404).json({ message: "Lawyer profile not found." });
        }

        response.json({ message: "Profile updated successfully", result });
      } catch (error) {
        console.error("Backend patching error:", error); // Helpful for logging stack traces
        response.status(500).json({ message: "Internal server error while updating profile." });
      }
    });

    // Get all registered lawyer profiles
    app.get('/api/collectawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.find().toArray();
        response.json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to fetch lawyers list." });
      }
    });


    // --- IMAGE ROUTES ---

    app.post('/api/images', async (request, response) => {
      try {
        const { userId, imageUrl } = request.body;

        if (!userId || !imageUrl) {
          return response.status(400).json({ error: "Missing userId or imageUrl." });
        }

        const imageResult = await imageCollection.insertOne({
          userId,
          imageUrl,
          uploadedAt: new Date()
        });

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

        if (!author || !rating || !text || !lawyerId || !userId) {
          return response.status(400).json({
            error: "Author, rating, text, lawyerId, and userId are required variables."
          });
        }

        const imageRecord = await imageCollection.findOne({ userId: userId });
        const userImage = imageRecord?.imageUrl || "";

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

        const result = await Comments.insertOne(commentPayload);

        response.status(201).json({
          _id: result.insertedId,
          ...commentPayload
        });
      } catch (error) {
        console.error("Database write execution failure details:", error);
        response.status(500).json({ error: "Failed to save secure comment briefing data." });
      }
    });

     // -- GET THE COMENTS WITH LAWYER ID 
    app.get('/api/comments/:lawyerId', async (request, response) => {
      try {
        const { lawyerId } = request.params;

        const matchStage = {};
        if (lawyerId && lawyerId !== "undefined") {
          matchStage.lawyerId = lawyerId;
        }

        const commentsWithLawyers = await Comments.aggregate([
          { $match: matchStage },
          {
            $lookup: {
              from: 'lawyer',
              localField: 'lawyerId',
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

    // GIT USER COMMENT WITH USER ID 
    app.get('/api/comments/user/:userId', async (request, response) => {
      try {
        const { userId } = request.params;

        if (!userId || userId === "undefined") {
          return response.status(400).json({ error: "Valid User ID parameter is required." });
        }

        
        const matchStage = {
          $or: [
            { userId: userId },
            { lawyerId: userId },
            ...(ObjectId.isValid(userId) ? [
              { userId: new ObjectId(userId) },
              { lawyerId: new ObjectId(userId) }
            ] : [])
          ]
        };

        console.log("📡 Running LexVizo Aggregation Matrix with Match Stage:", JSON.stringify(matchStage, null, 2));

        const userComments = await Comments.aggregate([
          { $match: matchStage },
          {
            $lookup: {
              
              from: 'lawyers',
              localField: 'lawyerId',
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

        console.log(`📥 Database matched ${userComments.length} documents for client pipeline.`);

        response.status(200).json(userComments);
      } catch (error) {
        console.error(" Failed to retrieve", error);
        response.status(500).json({ error: "Failed to retrieve user evaluation records." });
      }
    });

    // UPDATAE TEH COMMENTS 

    app.patch('/api/comments/:commentId', async (request, response) => {
      try {
        const { commentId } = request.params;
        const { text, rating } = request.body; 

        if (!commentId || commentId === "undefined") {
          return response.status(400).json({ error: "Comment ID is required." });
        }

        const query = {
          _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId
        };

        
        const updateFields = {};
        if (text !== undefined) updateFields.text = text;
        if (rating !== undefined) updateFields.rating = Number(rating);
        updateFields.updatedAt = new Date(); 

        const result = await Comments.updateOne(query, { $set: updateFields });

        if (result.matchedCount === 0) {
          return response.status(404).json({ error: "Target comment asset not found." });
        }

        response.status(200).json({ success: true, message: "Comment successfully updated." });
      } catch (error) {
        console.error("Failed to update comment record:", error);
        response.status(500).json({ error: "An error occurred while saving updates." });
      }
    });


    // DELETE TEH COMMENTS 

    app.delete('/api/comments/:commentId', async (request, response) => {
      try {
        const { commentId } = request.params;

        if (!commentId || commentId === "undefined") {
          return response.status(400).json({ error: "Comment ID is required." });
        }

        const query = {
          _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId
        };

        const result = await Comments.deleteOne(query);

        if (result.deletedCount === 0) {
          return response.status(404).json({ error: "Target comment asset not found or already missing." });
        }

        response.status(200).json({ success: true, message: "Comment successfully deleted." });
      } catch (error) {
        console.error("Failed to eliminate comment record:", error);
        response.status(500).json({ error: "An unexpected error occurred during record removal." });
      }
    });


    // --- HIRING PIPELINE INTERFACES ---

    // 1. POST: Client creates the contract request
    app.post("/api/hiring", async (req, res) => {
      try {
        const { clientId, clientName, clientEmail, lawyerId, caseType, urgency, pricingDetails } = req.body;

        const newRequest = {
          clientId,
          clientName,
          clientEmail,
          lawyerId,
          caseType,
          urgency,
          pricingDetails,
          status: "pending",
          createdAt: new Date()
        };

        const result = await HireRequest.insertOne(newRequest);
        res.status(201).json({ _id: result.insertedId, ...newRequest });
      } catch (error) {
        res.status(500).json({ error: "Failed to complete pipeline assignment initialization write." });
      }
    });

    // 2. PATCH: Lawyer accepts or rejects the pipeline listing
    app.patch("/api/hiring/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body; // "accepted" or "rejected"

        const result = await HireRequest.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status, updatedDecisionAt: new Date() } },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(404).json({ error: "Hiring transaction document targeted could not be found." });
        }
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to update pipeline listing status tracking data." });
      }
    });

    // 3. POST: Client handles checkout gateway resolution
    app.post("/api/hiring/:id/payment", async (req, res) => {
      try {
        const { id } = req.params;
        const { paymentDetails } = req.body;

        const result = await HireRequest.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status: "paid", paymentMetadata: paymentDetails, paidAt: new Date() } },
          { returnDocument: "after" }
        );

        if (!result) {
          return res.status(404).json({ error: "Hiring transaction target mapping error." });
        }
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ error: "Failed to inject validated gateway ledger settlement parameters." });
      }
    });
    // 4. GET: Fetch all active pending requests for a specific lawyer
    app.get("/api/hiring", async (req, res) => {
      try {
        const { lawyerId } = req.query;

        if (!lawyerId) {
          return res.status(400).json({ error: "Missing lawyerId query parameter." });
        }

        // Finds documents matching this specific lawyer that still need a decision
        const requests = await HireRequest.find({
          lawyerId: lawyerId,
          status: "pending"
        }).sort({ createdAt: -1 }).toArray();

        res.status(200).json(requests);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to read lawyer hiring history pipeline." });
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