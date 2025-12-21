const express = require("express");
const cors = require("cors");
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
//middleware
app.use(cors());
app.use(express.json());
//mongo db
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programming.bmabwzr.mongodb.net/?appName=Programming`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

const db=client.db('voyago_db');
const ticketCollection =db.collection('tickets')
 
app.get('/tickets',async(req,res)=>{

})
app.post('/tickets',async(req,res)=>{
  const ticket = req.body
  const result =await ticketCollection.insertOne(ticket)
  res.send(result)
})

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Voyago Server Running 🚀");
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
