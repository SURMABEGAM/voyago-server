const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");

const app = express();

// ============================================================
// Firebase Admin Initialization
// ============================================================
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8",
);
const serviceAccountDecoded = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountDecoded),
});

// ============================================================
// Global Middleware
// ============================================================
app.use(cors());
app.use(express.json());

// ============================================================
// MongoDB Connection URI
// ============================================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programming.bmabwzr.mongodb.net/?appName=Programming`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ============================================================
// JWT Middleware - Verifies the Bearer token from request header
// ============================================================
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden: Invalid token" });
    }
    req.user = decoded;
    next();
  });
};

// ============================================================
// Role-based Middleware - Only allows admin users
// ============================================================
const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
};

// ============================================================
// Role-based Middleware - Only allows vendor users
// ============================================================
const verifyVendor = (req, res, next) => {
  if (req.user.role !== "vendor") {
    return res.status(403).json({ message: "Vendor access only" });
  }
  next();
};

// ============================================================
// Main async function - All DB operations and routes go here
// so that collections are available before routes are called
// ============================================================
async function run() {
  try {
    // Connect to MongoDB
    await client.connect();

    const db = client.db("voyago_db");

    // Initialize all collections
    const usersCollection = db.collection("users");
    const ticketsCollection = db.collection("tickets");
    const bookingCollection = db.collection("booking");
    const transactionsCollection = db.collection("transactions");

    console.log("MongoDB connected successfully!");

    // ==========================================================
    // AUTH ROUTES
    // ==========================================================

    // Register a new user with hashed password
    app.post("/api/register", async (req, res) => {
      try {
        const { name, email, password } = req.body;

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).json({ message: "Email already exists" });
        }

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        await usersCollection.insertOne({
          name,
          email,
          password: hashedPassword,
          role: "user",
          createdAt: new Date(),
        });

        res.status(201).json({ message: "User registered successfully" });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // Login user and return a signed JWT token
    app.post("/api/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        // Find user by email
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Compare provided password with the stored hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ message: "Incorrect password" });
        }

        // Sign a JWT with user info, expires in 15 days
        const token = jwt.sign(
          { email: user.email, id: user._id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "15d" },
        );

        res.json({ token, role: user.role, email: user.email });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // Get currently logged-in user's profile (excludes password)
    app.get("/api/me", verifyToken, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { _id: new ObjectId(req.user.id) },
          { projection: { password: 0 } },
        );
        res.json(user);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // ==========================================================
    // USER ROUTES
    // ==========================================================

    // Get role of a user by email (used for frontend role checks)
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.send({ role: user.role });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // ==========================================================
    // ADMIN ROUTES
    // ==========================================================

    // Get all registered users (admin only, passwords excluded)
    app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find({}, { projection: { password: 0 } })
          .toArray();
        res.json(users);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // Get all payment transactions (admin only)
    app.get(
      "/api/admin/payments",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const payments = await transactionsCollection
            .find({})
            .sort({ date: -1 })
            .toArray();
          res.status(200).json(Array.isArray(payments) ? payments : []);
        } catch (error) {
          res.status(500).json([]);
        }
      },
    );

    // Manually save a payment record (admin only)
    app.post(
      "/api/admin/payments",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { email, amount, transactionId } = req.body;

          if (!email || !amount) {
            return res.status(400).json({ message: "Missing required fields" });
          }

          const result = await transactionsCollection.insertOne({
            email,
            amount,
            transactionId,
            createdAt: new Date(),
          });

          res.status(201).json(result);
        } catch (error) {
          res.status(500).json({ message: "Insert failed" });
        }
      },
    );

    // Approve a booking by ID (admin/vendor action)
    app.patch("/api/requested-booking/approve/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Approved" } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Reject a booking by ID (admin/vendor action)
    app.patch("/api/requested-booking/reject/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Rejected" } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Update ticket verification status (admin action: approved/rejected)
    app.patch("/api/tickets/status/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { verificationStatus: status } },
        );
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // ==========================================================
    // VENDOR ROUTES
    // ==========================================================

    // Add a new ticket (vendor only, secured route)
    app.post(
      "/api/vendor/tickets",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        try {
          const ticket = req.body;
          const result = await ticketsCollection.insertOne({
            ...ticket,
            vendorEmail: req.user.email,
            createdAt: new Date(),
          });
          res.json(result);
        } catch (error) {
          res.status(500).json({ message: error.message });
        }
      },
    );

    // Get all bookings (vendor can view all requested bookings)
    app.get("/api/requested-booking", async (req, res) => {
      try {
        const result = await bookingCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ==========================================================
    // TICKET ROUTES
    // ==========================================================

    // Get all tickets (public access)
    app.get("/api/tickets", async (req, res) => {
      try {
        const tickets = await ticketsCollection.find().toArray();
        res.send(tickets);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // Add a new ticket (open route, sets default status)
    app.post("/api/tickets", async (req, res) => {
      try {
        const ticket = req.body;
        ticket.verificationStatus = "pending"; // Needs admin approval
        ticket.isAdvertised = false;
        const result = await ticketsCollection.insertOne(ticket);
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // ==========================================================
    // BOOKING ROUTES
    // ==========================================================

    // Get all bookings for a specific user email
    app.get("/bookings/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await bookingCollection.find({ email }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    // Save a booking directly (without Stripe - fallback or manual)
    app.post("/api/booking", async (req, res) => {
      try {
        const booking = req.body;
        const result = await bookingCollection.insertOne(booking);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to book ticket" });
      }
    });

    // Confirm booking after Stripe payment is verified
    app.post("/api/confirm-booking", async (req, res) => {
      const { sessionId } = req.body;

      try {
        // Retrieve the Stripe session to verify payment
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === "paid") {
          // Avoid duplicate bookings for the same session
          const exists = await bookingCollection.findOne({ sessionId });
          if (exists) {
            return res.send({ success: true, message: "Already saved" });
          }

          // Build booking data from Stripe session metadata
          const bookingData = {
            sessionId,
            ticketId: session.metadata.ticketId,
            customerName: session.customer_email,
            email: session.customer_email,
            from: session.metadata.from,
            to: session.metadata.to,
            busType: session.metadata.busType,
            price: session.amount_total / 100,
            status: "paid",
            adminStatus: "pending",
            createdAt: new Date(),
          };

          const result = await bookingCollection.insertOne(bookingData);
          res.send({ success: true, result });
        } else {
          res.status(400).send({ error: "Payment not completed" });
        }
      } catch (error) {
        res.status(500).send({ error: "Booking confirmation failed" });
      }
    });

    // ==========================================================
    // STRIPE PAYMENT ROUTES
    // ==========================================================

    // Create a Stripe Checkout session for a ticket purchase
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { ticketId, email } = req.body;

        // Find the ticket in DB
        const ticket = await ticketsCollection.findOne({
          _id: new ObjectId(ticketId),
        });

        if (!ticket) {
          return res.status(404).json({ message: "Ticket not found" });
        }

        // Validate travel date is not in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Only allow booking within the next 7 days
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + 7);
        maxDate.setHours(23, 59, 59, 999);

        const travelDate = new Date(ticket.departureDate + "T00:00:00");

        if (travelDate < today) {
          return res.status(400).json({ message: "Cannot book a past date" });
        }

        if (travelDate > maxDate) {
          return res.status(400).json({
            message: "You can only book within the next 7 days",
          });
        }

        // Create a Stripe checkout session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: email,
          metadata: {
            ticketId: ticket._id.toString(),
            from: ticket.from,
            to: ticket.to,
            busType: ticket.busType,
          },
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: ticket.title },
                unit_amount: ticket.price * 100, // Stripe uses cents
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.DOMAIN_STRIPE}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.DOMAIN_STRIPE}/stripe/cancel`,
        });

        res.json({ url: session.url });
      } catch (error) {
        console.error("Stripe session error:", error);
        res.status(500).json({ error: "Payment session creation failed" });
      }
    });

    // Save transaction record after successful Stripe payment
    app.post("/save-transaction", async (req, res) => {
      try {
        const { sessionId } = req.body;

        // Retrieve session from Stripe to get payment details
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transaction = {
          email: session.customer_email,
          title: session.metadata?.title,
          ticketId: session.metadata?.ticketId,
          amount: session.amount_total / 100,
          transactionId: session.id,
          date: new Date(),
        };

        await transactionsCollection.insertOne(transaction);
        res.json({ success: true });
      } catch (error) {
        console.error("Transaction save error:", error);
        res.status(500).json({ error: "Failed to save transaction" });
      }
    });

    // Get all transactions for a specific user email
    app.get("/transactions/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await transactionsCollection.find({ email }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Transaction fetch error:", error);
        res.status(500).send([]);
      }
    });

    // ==========================================================
    // DEFAULT HEALTH CHECK ROUTE
    // ==========================================================
    app.get("/", (req, res) => {
      res.send("Voyago Server Running 🚀");
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
  }
}

// Start the database connection and initialize all routes
run().catch(console.dir);

// ============================================================
// Start the Express server - only ONE listen call here
// ============================================================
app.listen(5000, () => {
  console.log("Server running on port 5000");
});
