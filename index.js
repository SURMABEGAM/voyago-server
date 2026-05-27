const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
console.log("Stripe Key:", process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const e = require("express");

const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programming.bmabwzr.mongodb.net/?appName=Programming`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection,
  ticketsCollection,
  bookingCollection,
  transactionsCollection;

// Middleware for JWT Verify
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
};

const verifyVendor = (req, res, next) => {
  if (req.user.role !== "vendor") {
    return res.status(403).json({ message: "Vendor access only" });
  }
  next();
};

async function run() {
  try {
    // await client.connect(); // DB Connect
    const db = client.db("voyago_db");
    usersCollection = db.collection("users");
    ticketsCollection = db.collection("tickets");
    bookingCollection = db.collection("booking");
    transactionsCollection = db.collection("transactions");

    console.log("MongoDB connected!");

    // ============= Auth Routes =============
    app.post("/api/register", async (req, res) => {
      try {
        const { name, email, password } = req.body;

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).json({ message: "Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await usersCollection.insertOne({
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

    app.post("/api/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ message: "Incorrect password" });
        }

        const token = jwt.sign(
          {
            email: user.email,
            id: user._id,
            role: user.role,
          },
          process.env.JWT_SECRET,
          { expiresIn: "15d" },
        );

        res.json({
          token,
          role: user.role,
          email: user.email,
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get("/api/me", verifyToken, async (req, res) => {
      const user = await usersCollection.findOne(
        { _id: new ObjectId(req.user.id) },
        { projection: { password: 0 } },
      );

      res.json(user);
    });

    // Admin: Get All Users
    app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection
        .find({}, { projection: { password: 0 } })
        .toArray();

      res.json(users);
    });

    // ================= ADMIN PAYMENTS GET =================
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

    // ================= ADMIN PAYMENT SAVE =================
    app.post(
      "/api/admin/payments",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { email, amount, transactionId } = req.body;

          if (!email || !amount) {
            return res.status(400).json({ message: "Missing fields" });
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

    app.listen(5000, () => {
      console.log("Server running ");
    });
  } catch (err) {
    console.log(err);
  }
}

// Vendor: Get All Users
app.post("/api/vendor/tickets", verifyToken, verifyVendor, async (req, res) => {
  const ticket = req.body;

  const result = await ticketsCollection.insertOne({
    ...ticket,
    vendorEmail: req.user.email,
    createdAt: new Date(),
  });

  res.json(result);
});

// ---------- USERS ----------

app.get("/users/role/:email", async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(404).send({ message: "User not found" });
  res.send({ role: user.role });
});
app.get("/bookings/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const result = await bookingCollection.find({ email: email }).toArray();

    res.send(result);
  } catch (error) {
    console.error("Booking fetch error:", error);
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

app.post("/api/booking", async (req, res) => {
  try {
    const booking = req.body;

    const result = await bookingCollection.insertOne(booking);

    res.send(result);
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).send({ message: "Failed to book ticket" });
  }
});

// ============= Ticket & Booking Routes =============
app.get("/api/tickets", async (req, res) => {
  const tickets = await ticketsCollection.find().toArray();
  //  console.log(tickets);
  res.send(tickets);
});

app.post("/api/confirm-booking", async (req, res) => {
  const { sessionId } = req.body;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      const exists = await bookingCollection.findOne({ sessionId });
      if (exists) {
        return res.send({ success: true, message: "Already saved" });
      }
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
    }
  } catch (error) {
    res.status(500).send({ error: "Booking failed" });
  }
});
//vandor requested bookings
app.get("/api/requested-booking", async (req, res) => {
  try {
    const result = await bookingCollection.find().toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});
//  Approve Booking
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
// Reject Booking
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
// Vendor Add Ticket
app.post("/api/tickets", async (req, res) => {
  const ticket = req.body;
  ticket.verificationStatus = "pending";
  ticket.isAdvertised = false;
  const result = await ticketsCollection.insertOne(ticket);
  res.send(result);
});

// Admin: Manage Tickets
app.patch("/api/tickets/status/:id", async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const filter = { _id: new ObjectId(id) };
  const updatedDoc = { $set: { verificationStatus: status } };
  const result = await ticketsCollection.updateOne(filter, updatedDoc);
  res.send(result);
});

// Create Stripe Checkout Session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { ticketId, email } = req.body;

    // ✅ Get ticket from DB
    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(ticketId),
    });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 7);
    maxDate.setHours(23, 59, 59, 999);

    const travelDate = new Date(ticket.departureDate + "T00:00:00");

    if (travelDate < today) {
      return res.status(400).json({
        message: "Cannot book past date",
      });
    }

    if (travelDate > maxDate) {
      return res.status(400).json({
        message: "You can only book within 7 days",
      });
    }

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
            product_data: {
              name: ticket.title,
            },
            unit_amount: ticket.price * 100, // cents
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
    console.error(error);
    res.status(500).json({ error: "Payment session failed" });
  }
});

app.post("/save-transaction", async (req, res) => {
  try {
    const { sessionId } = req.body;

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
    console.log(error);
    res.status(500).json({ error: "Save failed" });
  }
});

app.get("/transactions/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const result = await transactionsCollection.find({ email }).toArray();

    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(500).send([]);
  }
});
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Voyago Server Running 🚀");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
