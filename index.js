// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 8080;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Allow requests from the frontend
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.CLIENT_URL,
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Connect to MongoDB and reuse the connection instead of reconnecting every time
const uri = process.env.MONGO_DB_URI;
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  cachedClient = client;
  cachedDb = client.db('LexVizo');
  return cachedDb;
}

// Health check — just confirms the server is up
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Use jose-cjs for JWT verification (standards-based, supports JWKS and symmetric keys)
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

// Checks the Authorization header and verifies the JWT token
const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token required.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    // Convert the shared secret to a Uint8Array for jose-cjs symmetric (HS256) verification
    const secret = new TextEncoder().encode(
      process.env.BETTER_AUTH_SECRET || 'fallback_secret_key_lexvizo_auth'
    );
    const { payload } = await jwtVerify(token, secret);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired token.' });
  }
};

// Checks that the logged-in user has one of the allowed roles
const authorizeRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Requires role: ${allowedRoles.join(' or ')}` });
    }
    next();
  };
};

// --- User Routes ---

// Update a user's name
app.put('/api/user/:userid', authenticateJWT, async (req, res) => {
  if (req.user.id !== req.params.userid && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Unauthorized profile update.' });
  }
  try {
    const db = await connectToDatabase();
    const Users = db.collection('user');
    const { userid } = req.params;
    const { fullName } = req.body;

    if (!ObjectId.isValid(userid)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
    }
    if (!fullName || fullName.trim() === '') {
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

    return res.status(200).json({
      success: true,
      message: 'User name updated successfully!',
      data: { ...updateResult, fullName: updateResult.name },
    });
  } catch (error) {
    console.error('Error updating name:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
});

// --- Lawyer Routes ---

// Save a new lawyer profile to the database
app.post('/api/lawyer', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const lawyerCollection = db.collection('lawyer');
    const result = await lawyerCollection.insertOne(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save lawyer profile.' });
  }
});

// Get a single lawyer's profile by their user ID
app.get('/api/lawyer/:userid', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const lawyerCollection = db.collection('lawyer');
    const data = await lawyerCollection.findOne({ userId: req.params.userid });
    if (!data) return res.status(404).json({ message: 'Lawyer profile not found.' });
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update specific fields on a lawyer's profile
app.patch('/api/lawyer/:userid', authenticateJWT, async (req, res) => {
  if (req.user.id !== req.params.userid && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Unauthorized profile modification.' });
  }
  try {
    const db = await connectToDatabase();
    const lawyerCollection = db.collection('lawyer');
    const { name, email, specialization, bio, hourlyFee, currency, profileImg, isBusy } = req.body;
    const updateDoc = { $set: {} };

    if (name !== undefined) updateDoc.$set.name = name;
    if (email !== undefined) updateDoc.$set.email = email;
    if (specialization !== undefined) updateDoc.$set.specialization = specialization;
    if (bio !== undefined) updateDoc.$set.bio = bio;
    if (hourlyFee !== undefined) updateDoc.$set.hourlyFee = hourlyFee;
    if (currency !== undefined) updateDoc.$set.currency = currency;
    if (profileImg !== undefined) updateDoc.$set.profileImg = profileImg;
    if (isBusy !== undefined) updateDoc.$set.isBusy = isBusy === true || isBusy === 'true';

    if (Object.keys(updateDoc.$set).length === 0) {
      return res.status(400).json({ message: 'No modifiable fields provided.' });
    }

    const result = await lawyerCollection.updateOne({ userId: req.params.userid }, updateDoc);
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Lawyer profile not found.' });
    }
    res.json({ message: 'Profile updated successfully', result });
  } catch (error) {
    console.error('Backend patching error:', error);
    res.status(500).json({ message: 'Internal server error while updating profile.' });
  }
});

// Get all lawyers (used for the browse lawyers page)
app.get('/api/collectlawyer', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const lawyerCollection = db.collection('lawyer');
    const result = await lawyerCollection.find().toArray();
    res.json(result);
  } catch (error) {
    console.error('Error fetching lawyers:', error);
    res.status(500).json({ error: 'Failed to fetch lawyers list.' });
  }
});

// --- Image Routes ---

// Save a new profile image and also update the lawyer's profile with it
app.post('/api/images', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const imageCollection = db.collection('images');
    const lawyerCollection = db.collection('lawyer');
    const { userId, imageUrl } = req.body;

    if (!userId || !imageUrl) {
      return res.status(400).json({ error: 'Missing userId or imageUrl.' });
    }

    const imageResult = await imageCollection.insertOne({ userId, imageUrl, uploadedAt: new Date() });
    await lawyerCollection.updateOne(
      { userId },
      { $set: { profileImg: imageUrl, imageUrl } }
    );
    return res.status(201).json({ success: true, imageUrl, imageResult });
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: 'Failed to save image.' });
  }
});

// Get the profile image for a user
app.get('/api/images/:userid', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const imageCollection = db.collection('images');
    const image = await imageCollection.findOne({ userId: req.params.userid });
    if (!image) return res.status(404).json({ message: 'No image found for this user.' });
    res.json(image);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update a user's existing profile image
app.patch('/api/images/:userid', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const imageCollection = db.collection('images');
    const lawyerCollection = db.collection('lawyer');
    const { imageUrl } = req.body;
    const { userid } = req.params;

    if (!imageUrl) return res.status(400).json({ message: 'New image URL is required.' });

    const imageResult = await imageCollection.updateOne(
      { userId: userid },
      { $set: { imageUrl, updatedAt: new Date() } }
    );
    if (imageResult.matchedCount === 0) {
      return res.status(404).json({ message: 'User image record not found.' });
    }
    await lawyerCollection.updateOne({ userId: userid }, { $set: { profileImg: imageUrl, imageUrl } });
    res.json({ message: 'Image updated successfully.', imageResult });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- Service Routes ---

// Get all services for a specific lawyer
app.get('/api/service', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Service = db.collection('Service');
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId query parameter is required.' });
    const results = await Service.find({ userId }).toArray();
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve service data.' });
  }
});

// Add a new service
app.post('/api/service', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Service = db.collection('Service');
    const { title, price, description, userId } = req.body;
    if (!title || !price || !userId) {
      return res.status(400).json({ error: 'Title, price, and userId are required.' });
    }
    const result = await Service.insertOne({ title, price: Number(price), description, userId, createdAt: new Date() });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save service data.' });
  }
});

// Update an existing service
app.put('/api/service/:id', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Service = db.collection('Service');
    const { id } = req.params;
    const { title, price, description, userId } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized. Missing user data.' });

    const result = await Service.updateOne(
      { _id: new ObjectId(id), userId },
      { $set: { title, price: Number(price), description } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Service not found or unauthorized access.' });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update service parameters.' });
  }
});

// Delete a service
app.delete('/api/service/:id', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Service = db.collection('Service');
    const { id } = req.params;
    const result = await Service.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Service not found or unauthorized access.' });
    res.status(200).json({ message: 'Service deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove service entity.' });
  }
});

// --- Comment Routes ---

// Post a new comment — only allowed if the user has actually hired that lawyer
app.post('/api/comments', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Comments = db.collection('comments');
    const HireRequest = db.collection('Hireing');
    const imageCollection = db.collection('images');
    const { author, role, rating, text, lawyerId, userId } = req.body;

    if (!author || !rating || !text || !lawyerId || !userId) {
      return res.status(400).json({ error: 'Missing required comment payload fields.' });
    }

    // Make sure the user has a paid or accepted hiring with this lawyer
    const hasHired = await HireRequest.findOne({
      clientId: userId,
      lawyerId,
      status: { $in: ['paid', 'accepted'] },
    });
    if (!hasHired) {
      return res.status(403).json({ error: 'Only users who have hired this lawyer can leave a comment.' });
    }

    const imageRecord = await imageCollection.findOne({ userId });
    const userImage = imageRecord?.imageUrl || '';

    const commentPayload = {
      author,
      role: role || 'client',
      rating: Number(rating),
      text,
      lawyerId,
      userId,
      userImage,
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date(),
    };

    const result = await Comments.insertOne(commentPayload);
    res.status(201).json({ _id: result.insertedId, ...commentPayload });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save comment briefing data.' });
  }
});

// Get all comments for a specific lawyer, including their profile details
app.get('/api/comments/:lawyerId', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Comments = db.collection('comments');
    const { lawyerId } = req.params;
    const matchStage = {};
    if (lawyerId && lawyerId !== 'undefined') matchStage.lawyerId = lawyerId;

    const commentsWithLawyers = await Comments.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'lawyer',
          let: { lawyer_id_str: '$lawyerId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    '$_id',
                    {
                      $cond: {
                        if: { $eq: [{ $type: '$$lawyer_id_str' }, 'string'] },
                        then: { $toObjectId: '$$lawyer_id_str' },
                        else: '$$lawyer_id_str'
                      }
                    }
                  ]
                }
              }
            }
          ],
          as: 'lawyerDetails',
        },
      },
      { $unwind: { path: '$lawyerDetails', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
    ]).toArray();

    res.status(200).json(commentsWithLawyers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve compiled evaluation records.' });
  }
});

// Get all comments made by or about a specific user
app.get('/api/comments/user/:userId', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Comments = db.collection('comments');
    const { userId } = req.params;
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'Valid User ID parameter is required.' });
    }

    const matchStage = {
      $or: [
        { userId },
        { lawyerId: userId },
        ...(ObjectId.isValid(userId)
          ? [{ userId: new ObjectId(userId) }, { lawyerId: new ObjectId(userId) }]
          : []),
      ],
    };

    const userComments = await Comments.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'lawyer',
          let: { lawyer_id_str: '$lawyerId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [
                    '$_id',
                    {
                      $cond: {
                        if: { $eq: [{ $type: '$$lawyer_id_str' }, 'string'] },
                        then: { $toObjectId: '$$lawyer_id_str' },
                        else: '$$lawyer_id_str'
                      }
                    }
                  ]
                }
              }
            }
          ],
          as: 'lawyerDetails',
        },
      },
      { $unwind: { path: '$lawyerDetails', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
    ]).toArray();

    res.status(200).json(userComments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user evaluation records.' });
  }
});

// Edit an existing comment's text or rating
app.patch('/api/comments/:commentId', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Comments = db.collection('comments');
    const { commentId } = req.params;
    const { text, rating } = req.body;

    if (!commentId || commentId === 'undefined') {
      return res.status(400).json({ error: 'Comment ID is required.' });
    }

    const query = { _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId };
    const updateFields = {};
    if (text !== undefined) updateFields.text = text;
    if (rating !== undefined) updateFields.rating = Number(rating);
    updateFields.updatedAt = new Date();

    const result = await Comments.updateOne(query, { $set: updateFields });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Target comment asset not found.' });
    res.status(200).json({ success: true, message: 'Comment successfully updated.' });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while saving updates.' });
  }
});

// Delete a comment
app.delete('/api/comments/:commentId', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Comments = db.collection('comments');
    const { commentId } = req.params;
    if (!commentId || commentId === 'undefined') {
      return res.status(400).json({ error: 'Comment ID is required.' });
    }

    const query = { _id: ObjectId.isValid(commentId) ? new ObjectId(commentId) : commentId };
    const result = await Comments.deleteOne(query);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Target comment asset not found or already missing.' });
    res.status(200).json({ success: true, message: 'Comment successfully deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred during record removal.' });
  }
});

// --- Hiring Routes ---

// Create a new hiring request when a client picks a lawyer
app.post('/api/hiring', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const HireRequest = db.collection('Hireing');
    const { clientId, clientName, clientEmail, lawyerId, lawyerEmail, lawyerName, lawyerImage, caseType, urgency, pricingDetails } = req.body;

    let validatedAmount = Number(pricingDetails?.amount);
    if (isNaN(validatedAmount) || validatedAmount <= 0) validatedAmount = 100;

    const newRequest = {
      clientId,
      clientName,
      clientEmail,
      lawyerId,
      lawyerEmail: lawyerEmail || '',
      lawyerName,
      lawyerImage: lawyerImage || '',
      caseType,
      urgency,
      pricingDetails: { type: pricingDetails?.type || 'hourly', amount: validatedAmount },
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await HireRequest.insertOne(newRequest);
    res.status(201).json({ _id: result.insertedId, ...newRequest });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete pipeline assignment initialization write.' });
  }
});

// Update the status of a hiring request (e.g. accepted, rejected, paid)
app.patch('/api/hiring/:id', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const HireRequest = db.collection('Hireing');
    const { id } = req.params;
    const { status } = req.body;

    const result = await HireRequest.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedDecisionAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Hiring transaction document targeted could not be found.' });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pipeline listing status tracking data.' });
  }
});

// Get all hiring requests for a lawyer or a client
app.get('/api/hiring', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const HireRequest = db.collection('Hireing');
    const { lawyerId, clientId } = req.query;

    if (!lawyerId && !clientId) {
      return res.status(400).json({ error: 'Missing identification parameters. Provide either lawyerId or clientId.' });
    }

    const queryFilter = lawyerId ? { lawyerId } : { clientId };
    const requests = await HireRequest.find(queryFilter).sort({ createdAt: -1 }).toArray();
    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read hiring dashboard data pipeline.' });
  }
});

// --- Payment Routes ---

// Create a Stripe checkout session so the client can pay the lawyer's fee
app.post('/api/payment/create-checkout-session', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const HireRequest = db.collection('Hireing');
    const { hiringId } = req.body;

    if (!hiringId) return res.status(400).json({ error: 'Backend received an empty or undefined hiringId payload.' });

    const queryFilter = ObjectId.isValid(hiringId) ? { _id: new ObjectId(hiringId) } : { _id: hiringId };
    const hiringRequest = await HireRequest.findOne(queryFilter);
    if (!hiringRequest) return res.status(404).json({ error: `No transaction records found matching ID: ${hiringId}` });

    let rawAmount = hiringRequest.pricingDetails?.amount || hiringRequest.amount;
    if (typeof rawAmount === 'string') rawAmount = rawAmount.replace(/[^0-9.]/g, '');
    let feeAmount = Number(rawAmount);
    if (isNaN(feeAmount) || feeAmount <= 0) feeAmount = 100;

    // Use the request origin so it works in both local and production
    const clientUrl = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Legal Retainer Registration',
            description: `Case Context Reference: ${hiringRequest.caseType || 'General Consultancy'}`,
          },
          unit_amount: Math.round(feeAmount * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: hiringRequest.clientEmail || undefined,
      success_url: `${clientUrl}/dashboard/user/hiring-history?payment_success=true&session_id={CHECKOUT_SESSION_ID}&hiringId=${hiringId}`,
      cancel_url: `${clientUrl}/dashboard/user/hiring-history?payment_cancelled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (stripeErr) {
    console.error('Stripe Checkout Generation Failure:', stripeErr.message);
    return res.status(500).json({ error: 'Stripe gateway session registration failed.', details: stripeErr.message });
  }
});

// Confirm a payment after Stripe redirects back — marks the hiring as paid and logs the transaction
app.post('/api/hiring/:id/payment', authenticateJWT, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const HireRequest = db.collection('Hireing');
    const Transactions = db.collection('transactions');
    const { id } = req.params;
    const { sessionId, paymentDetails } = req.body;
    const actualSessionId = sessionId || paymentDetails;

    if (!actualSessionId) return res.status(400).json({ error: 'Session token reference missing.' });

    const sessionDetails = await stripe.checkout.sessions.retrieve(actualSessionId);
    if (sessionDetails.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Stripe execution loop maps state as unpaid.' });
    }

    // If this transaction was already saved, just return the hiring record
    const existingTx = await Transactions.findOne({ transactionId: sessionDetails.payment_intent });
    if (existingTx) {
      const contextRecord = await HireRequest.findOne({ _id: new ObjectId(id) });
      return res.status(200).json(contextRecord);
    }

    const updatedHiring = await HireRequest.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status: 'paid', stripeSessionId: actualSessionId, transactionId: sessionDetails.payment_intent, paidAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!updatedHiring) return res.status(404).json({ error: 'Hiring transaction target mapping error.' });

    // Fall back to looking up the lawyer's email from the database if it wasn't stored on the hiring record
    let lawyerEmail = updatedHiring.lawyerEmail;
    if (!lawyerEmail) {
      const lawyerCollection = db.collection('lawyer');
      const lawyerDoc = await lawyerCollection.findOne({
        $or: [
          { userId: updatedHiring.lawyerId },
          ...(ObjectId.isValid(updatedHiring.lawyerId) ? [{ _id: new ObjectId(updatedHiring.lawyerId) }] : [])
        ]
      });
      lawyerEmail = lawyerDoc?.email || 'assigned-expert@lexvizo.com';
    }

    // Save the transaction to the admin ledger
    await Transactions.insertOne({
      transactionId: sessionDetails.payment_intent,
      userEmail: updatedHiring.clientEmail,
      lawyerEmail: lawyerEmail,
      amount: Number(updatedHiring.pricingDetails?.amount || 100),
      date: new Date(),
      hiringId: new ObjectId(id),
    });

    res.status(200).json(updatedHiring);
  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: 'Failed to inject validated gateway ledger settlement parameters.' });
  }
});

// --- Admin Routes (requires admin role) ---

// Get all registered users
app.get('/api/admin/users', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Users = db.collection('user');
    const userList = await Users.find({}, { projection: { password: 0 } }).toArray();
    res.status(200).json(userList);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve user registry logs.' });
  }
});

// Change a user's role (e.g. promote to admin or lawyer)
app.patch('/api/admin/users/:id', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Users = db.collection('user');
    const { id } = req.params;
    const { role } = req.body;
    const queryFilter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await Users.updateOne(queryFilter, { $set: { role } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.status(200).json({ success: true, message: 'User role updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user privilege status.' });
  }
});

// Delete a user account
app.delete('/api/admin/users/:id', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Users = db.collection('user');
    const { id } = req.params;
    const queryFilter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await Users.deleteOne(queryFilter);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'User not found.' });
    res.status(200).json({ success: true, message: 'User terminated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// Get all payment transactions for the admin dashboard
app.get('/api/admin/transactions', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Transactions = db.collection('transactions');
    const transactionList = await Transactions.find({}).sort({ date: -1 }).toArray();
    res.status(200).json(transactionList);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ledger logs.' });
  }
});

// Get platform-wide stats: total users, lawyers, hires, and revenue
app.get('/api/admin/analytics', authenticateJWT, authorizeRole(['admin']), async (req, res) => {
  try {
    const db = await connectToDatabase();
    const Users = db.collection('user');
    const lawyerCollection = db.collection('lawyer');
    const HireRequest = db.collection('Hireing');
    const Transactions = db.collection('transactions');

    const [totalUsers, totalLawyers, totalHires, revenueAggregate] = await Promise.all([
      Users.countDocuments({}),
      lawyerCollection.countDocuments({}),
      HireRequest.countDocuments({}),
      Transactions.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
    ]);

    res.status(200).json({
      totalUsers,
      totalLawyers,
      totalHires,
      totalRevenue: revenueAggregate[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute analytical metrics.' });
  }
});

// Start the server locally (skipped on Vercel since it uses serverless functions)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

// Export the app for Vercel serverless deployment
module.exports = app;