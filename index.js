const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = 8080;

// =========================================================================
// 1. ENVIRONMENT CONFIGURATION & CONFIG INITIALIZATION (MUST BE AT THE TOP)
// =========================================================================
require('dotenv').config();
app.use(cors());
app.use(express.json());

// Initialize Stripe now that dotenv has populated process.env safely
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

console.log(process.env.STRIPE_SECRET_KEY)

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// =========================================================================
// 2. DATABASE SYSTEM CONNECTIONS
// =========================================================================
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

    const Users = db.collection('user');
    const lawyerCollection = db.collection('lawyer');
    const Service = db.collection('Service');
    const imageCollection = db.collection('images');
    const Comments = db.collection('comments');
    const HireRequest = db.collection('Hireing');
    const Transactions = db.collection('transactions');

    console.log("Successfully connected to MongoDB.");

    // =========================================================================
    // 3. USER MANAGEMENT ROUTER REGISTRY
    // =========================================================================
    app.put('/api/user/:userid', async (req, res) => {
      try {
        const { userid } = req.params;
        const { fullName } = req.body;

        if (!ObjectId.isValid(userid)) {
          return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
        }

        if (!fullName || fullName.trim() === "") {
          return res.status(400).json({ success: false, message: 'A valid name parameter is required.' });
        }

        const updateResult = await Users.findOneAndUpdate(
          { _id: new ObjectId(userid) },
          { $set: { name: fullName.trim() } },
          { returnDocument: 'after', projection: { password: 0 } }
        );

        if (!updateResult) {
          return res.status(404).json({ success: false, message: 'User matching that ID was not found.' });
        }

        const responseData = {
          ...updateResult,
          fullName: updateResult.name
        };

        return res.status(200).json({
          success: true,
          message: 'User name updated successfully!',
          data: responseData
        });
      } catch (error) {
        console.error('Error updating name:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error.' });
      }
    });

    // =========================================================================
    // 4. LAWYER MANAGEMENT ROUTER REGISTRY
    // =========================================================================
    app.post('/api/lawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.insertOne(request.body);
        response.status(201).json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to save lawyer profile." });
      }
    });

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

    app.patch('/api/lawyer/:userid', async (request, response) => {
      try {
        const { name, email, specialization, bio, hourlyFee, currency, profileImg, isBusy } = request.body;
        const updateDoc = { $set: {} };

        if (name !== undefined) updateDoc.$set.name = name;
        if (email !== undefined) updateDoc.$set.email = email;
        if (specialization !== undefined) updateDoc.$set.specialization = specialization;
        if (bio !== undefined) updateDoc.$set.bio = bio;
        if (hourlyFee !== undefined) updateDoc.$set.hourlyFee = hourlyFee;
        if (currency !== undefined) updateDoc.$set.currency = currency;
        if (profileImg !== undefined) updateDoc.$set.profileImg = profileImg;

        if (isBusy !== undefined) {
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
        console.error("Backend patching error:", error);
        response.status(500).json({ message: "Internal server error while updating profile." });
      }
    });

    app.get('/api/collectawyer', async (request, response) => {
      try {
        const result = await lawyerCollection.find().toArray();
        response.json(result);
      } catch (error) {
        response.status(500).json({ error: "Failed to fetch lawyers list." });
      }
    });

    // =========================================================================
    // 5. IMAGES & CUSTOM ASSET INTERFACES
    // =========================================================================
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

        return response.status(201).json({ success: true, imageUrl: imageUrl, imageResult });
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

        response.json({ message: "Image updated successfully.", imageResult });
      } catch (error) {
        response.status(500).json({ message: "Internal server error." });
      }
    });

    // =========================================================================
    // 6. FIRM SERVICES ROUTER
    // =========================================================================
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
        const result = await Service.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return response.status(404).json({ error: "Service not found or unauthorized access." });
        }
        response.status(200).json({ message: "Service deleted successfully." });
      } catch (error) {
        response.status(500).json({ error: "Failed to remove service entity." });
      }
    });

    // =========================================================================
    // 7. CLIENT EVALUATION COMMENTS AND FEEDBACK
    // =========================================================================
    app.post('/api/comments', async (request, response) => {
      try {
        const { author, role, rating, text, lawyerId, userId } = request.body;

        if (!author || !rating || !text || !lawyerId || !userId) {
          return response.status(400).json({ error: "Missing required comment payload fields." });
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
        response.status(201).json({ _id: result.insertedId, ...commentPayload });
      } catch (error) {
        response.status(500).json({ error: "Failed to save comment briefing data." });
      }
    });

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
        response.status(500).json({ error: "Failed to retrieve compiled evaluation records." });
      }
    });

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

        response.status(200).json(userComments);
      } catch (error) {
        response.status(500).json({ error: "Failed to retrieve user evaluation records." });
      }
    });

    app.patch('/api/comments/:commentId', async (request, response) => {
      try {
        const { commentId } = request.params;
        const { text, rating } = request.body;

        if (!commentId || commentId === "undefined") {
          return response.status(400).json({ error: "Comment ID is required." });
        }

        const query = { _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId };
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
        response.status(500).json({ error: "An error occurred while saving updates." });
      }
    });

    app.delete('/api/comments/:commentId', async (request, response) => {
      try {
        const { commentId } = request.params;
        if (!commentId || commentId === "undefined") {
          return response.status(400).json({ error: "Comment ID is required." });
        }

        const query = { _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId };
        const result = await Comments.deleteOne(query);

        if (result.deletedCount === 0) {
          return response.status(404).json({ error: "Target comment asset not found or already missing." });
        }
        response.status(200).json({ success: true, message: "Comment successfully deleted." });
      } catch (error) {
        response.status(500).json({ error: "An unexpected error occurred during record removal." });
      }
    });

    // =========================================================================
    // 8. LEGAL ENGAGEMENT & PIPELINE MANAGEMENT
    // =========================================================================
    app.post("/api/hiring", async (req, res) => {
      try {
        const { clientId, clientName, clientEmail, lawyerId, lawyerName, lawyerImage, caseType, urgency, pricingDetails } = req.body;
        const incomingAmount = pricingDetails?.amount;
        let validatedAmount = Number(incomingAmount);

        if (isNaN(validatedAmount) || validatedAmount <= 0) {
          validatedAmount = 100;
        }

        const newRequest = {
          clientId,
          clientName,
          clientEmail,
          lawyerId,
          lawyerName,
          lawyerImage: lawyerImage || "",
          caseType,
          urgency,
          pricingDetails: {
            type: pricingDetails?.type || "hourly",
            amount: validatedAmount
          },
          status: "pending",
          createdAt: new Date()
        };

        const result = await HireRequest.insertOne(newRequest);
        res.status(201).json({ _id: result.insertedId, ...newRequest });
      } catch (error) {
        res.status(500).json({ error: "Failed to complete pipeline assignment initialization write." });
      }
    });

    app.patch("/api/hiring/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

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

    app.get("/api/hiring", async (req, res) => {
      try {
        const { lawyerId, clientId } = req.query;
        if (!lawyerId && !clientId) {
          return res.status(400).json({ error: "Missing identification parameters. Provide either lawyerId or clientId." });
        }

        let queryFilter = {};
        if (lawyerId) {
          queryFilter = { lawyerId: lawyerId };
        } else if (clientId) {
          queryFilter = { clientId: clientId };
        }

        const requests = await HireRequest.find(queryFilter).sort({ createdAt: -1 }).toArray();
        res.status(200).json(requests);
      } catch (error) {
        res.status(500).json({ error: "Failed to read hiring dashboard data pipeline." });
      }
    });

    // =========================================================================
    // 9. RE-ARCHITECTED SECURE PAYMENT PROCESSORS (STRIPE)
    // =========================================================================
    app.post("/api/payment/create-checkout-session", async (req, res) => {
      try {
        const { hiringId } = req.body;
        console.log("==> PAYMENT REQUEST RECEIVED FOR ID:", hiringId);

        if (!hiringId) {
          return res.status(400).json({ error: "Backend received an empty or undefined hiringId payload." });
        }

        let queryFilter = {};
        if (ObjectId.isValid(hiringId)) {
          queryFilter = { _id: new ObjectId(hiringId) };
        } else {
          queryFilter = { _id: hiringId };
        }

        const hiringRequest = await HireRequest.findOne(queryFilter);

        if (!hiringRequest) {
          console.log(`❌ DB Miss: Document ${hiringId} not found in collection 'Hireing'`);
          return res.status(404).json({ error: `No transaction records found matching ID: ${hiringId}` });
        }

        // --- DEFENSIVE PROCESSING OF THE AMOUNT ---
        let rawAmount = hiringRequest.pricingDetails?.amount || hiringRequest.amount;
        console.log("🔍 Raw amount extracted from DB:", rawAmount);

        // Strip out currency symbols or commas if stored as a string
        if (typeof rawAmount === 'string') {
          rawAmount = rawAmount.replace(/[^0-9.]/g, '');
        }

        let feeAmount = Number(rawAmount);

        // Safe fallback default if database value is corrupted or missing
        if (isNaN(feeAmount) || feeAmount <= 0) {
          console.log("⚠️ Warning: Invalid amount numeric parse. Defaulting to fallback value of 100.");
          feeAmount = 100;
        }

        const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

        // Generate Stripe checkout pipeline session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `Legal Retainer Registration`,
                  description: `Case Context Reference: ${hiringRequest.caseType || "General Consultancy"}`
                },
                unit_amount: Math.round(feeAmount * 100), // Secure conversion to cents
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          customer_email: hiringRequest.clientEmail || undefined,
          success_url: `${clientUrl}/dashboard/client?payment_success=true&session_id={CHECKOUT_SESSION_ID}&hiringId=${hiringId}`,
          cancel_url: `${clientUrl}/dashboard/client?payment_cancelled=true`,
        });

        console.log("✅ SUCCESS: Stripe session url constructed:", session.url);
        return res.status(200).json({ url: session.url });

      } catch (stripeErr) {
        // This will print the precise reason why Stripe rejected your secret key or payload config
        console.error("❌ Stripe Checkout Generation Failure Detail:", stripeErr);
        return res.status(500).json({ error: "Stripe gateway session registration failed.", details: stripeErr.message });
      }
    });

    app.post("/api/hiring/:id/payment", async (req, res) => {
      try {
        const { id } = req.params;
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).json({ error: "Session token reference missing." });
        }

        const sessionDetails = await stripe.checkout.sessions.retrieve(sessionId);
        if (sessionDetails.payment_status !== 'paid') {
          return res.status(400).json({ error: "Stripe execution loop maps state as unpaid." });
        }

        const existingTx = await Transactions.findOne({ transactionId: sessionDetails.payment_intent });
        if (existingTx) {
          const contextRecord = await HireRequest.findOne({ _id: new ObjectId(id) });
          return res.status(200).json(contextRecord);
        }

        const updatedHiring = await HireRequest.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "paid",
              stripeSessionId: sessionId,
              transactionId: sessionDetails.payment_intent,
              paidAt: new Date()
            }
          },
          { returnDocument: "after" }
        );

        if (!updatedHiring) {
          return res.status(404).json({ error: "Hiring transaction target mapping error." });
        }

        await Transactions.insertOne({
          transactionId: sessionDetails.payment_intent,
          userEmail: updatedHiring.clientEmail,
          lawyerEmail: updatedHiring.lawyerEmail || "assigned-expert@lexvizo.com",
          amount: Number(updatedHiring.pricingDetails?.amount || 100),
          date: new Date(),
          hiringId: new ObjectId(id)
        });

        res.status(200).json(updatedHiring);
      } catch (error) {
        console.error("Payment confirmation error:", error);
        res.status(500).json({ error: "Failed to inject validated gateway ledger settlement parameters." });
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