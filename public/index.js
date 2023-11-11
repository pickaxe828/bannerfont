const express = require("express");
const cors = require("cors")
const app = express();
const port = process.env.PORT || 8080;

app.use("*", cors())
app.use("/static", express.static("./font/"));

app.get("/", (req, res) => {
  res.send("Hello from BannerFont 👋🏻");
});

app.listen(port, () => {
  console.log(`App listening on port ${port}!`);
});