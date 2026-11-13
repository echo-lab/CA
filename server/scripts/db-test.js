require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const docs = await client.db().collection("test").find().toArray();
  console.log(docs);
  await client.close();
})();
