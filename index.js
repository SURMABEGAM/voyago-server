const express = require("express");
const cors = require("cors");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programming.bmabwzr.mongodb.net/?appName=Programming`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let usersCollection, ticketsCollection, bookingsCollection;

// Middleware for JWT Verify
const verifyToken = (req, res, next) => {
  const token = req?.headers?.authorization;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized access" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "qwertyuoosklsf", (err, decodedData) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden access" });
    }
    req.user = decodedData;
    next();
  });
};

async function run() {
  try {
    // await client.connect(); // DB Connect
    const db = client.db('voyago_db');
    usersCollection = db.collection("users");
    ticketsCollection = db.collection("tickets");
    bookingsCollection = db.collection("bookings");

    console.log("MongoDB connected!");

    // ============= Auth Routes =============
    app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existing = await usersCollection.findOne({ email });
    if (existing) return res.status(409).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await usersCollection.insertOne({
      name,
      email,
      password: hashedPassword,
      role: "user"
    });
    res.status(201).json({ message: "User registered successfully!", result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


    app.post("/login", async (req, res) => {
      try {
        const { email, password } = req.body;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        const isMatched = await bcrypt.compare(password, user.password);
        if (!isMatched) return res.status(401).json({ message: "Incorrect password" });

        const token = jwt.sign(
          { email: user.email, _id: user._id },
          process.env.JWT_SECRET || "qwertyuoosklsf",
          { expiresIn: "3h" }
        );
        res.status(200).json({ message: "Logged in!", token });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    
        app.get("/me", verifyToken, async (req, res) => {
            try {
                const user = req.user;
                const userData = await usersCollection.findOne({
                    _id: new ObjectId(user._id)
                }, {
                    projection: { password: 0 }
                })

                res.status(200).json(userData);
            } catch (err) {
                res.status(400).json({
                    message: "Failed to fetch profile data!",
                    err
                })
            }
        })
    

// ---------- USERS ----------

app.get("/users/role/:email", async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email }); // MongoDB থেকে খুঁজ
  if (user) {
    res.send({ role: user.role });
  } else {
    res.status(404).send({ message: "User not found" });
  }
});

// register করার route
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  // এখানে database এ user save করো
  res.send({ message: "User registered successfully" });
});

    // ============= Ticket & Booking Routes =============
    app.get("/api/tickets", async (req, res) => {
      const tickets = await ticketsCollection.find().toArray();
      res.send(tickets);
    });

    app.post("/api/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.json(result);
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

  } finally {
    // keeping connection open
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Voyago Server Running 🚀");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
