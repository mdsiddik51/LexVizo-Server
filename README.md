# ⚖️ LexVizo Backend API

The core backend service for **LexVizo**, a marketplace connecting clients with legal professionals. This service manages user profiles, lawyer directories, case bookings, ratings/reviews, admin insights, and handles secure payment processing through Stripe.

Built for seamless standalone execution or serverless environments (optimized for Vercel).

---

## 🛠️ Tech Stack

* **Runtime Environment:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB (with connection pooling/caching)
* **Authentication:** JWT Token Verification via `jose-cjs`
* **Payment Gateway:** Stripe API
* **Deployment:** Vercel Serverless Functions compatible

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory of your project and populate it with the following keys:

```env
PORT=8080
NODE_ENV=development
MONGO_DB_URI=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_jwt_shared_secret_key
STRIPE_SECRET_KEY=your_stripe_secret_key
CLIENT_URL=http://localhost:3000




