const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const logger = require("./utils/logger");
const errorHandler = require("./middleware/error.middleware");

const healthRoutes = require("./routes/health.routes");
const voiceRoutes = require("./routes/voice.routes");
const visionRoutes = require("./routes/vision.routes");
const navigationRoutes = require("./routes/navigation.routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/vision", visionRoutes);
app.use("/api/navigation", navigationRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Centralized Error Handling
app.use(errorHandler);

if (require.main === module) {
  app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Backend running on http://0.0.0.0:${env.PORT}`);
  });
}

module.exports = app; // export for testing
