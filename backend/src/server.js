const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const logger = require("./utils/logger");
const errorHandler = require("./middleware/error.middleware");
const requestLogger = require("./middleware/request-logger.middleware");

const healthRoutes = require("./routes/health.routes");
const voiceRoutes = require("./routes/voice.routes");
const visionRoutes = require("./routes/vision.routes");
const navigationRoutes = require("./routes/navigation.routes");
const gpsRoutes = require("./routes/gps.routes");
const sosRoutes = require("./routes/sos.routes");

const app = express();

// CORS: restrict to configured origins instead of allowing all
// In development: localhost. For Raspberry Pi: add its IP via CORS_ORIGINS env var.
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/vision", visionRoutes);
app.use("/api/navigation", navigationRoutes);
app.use("/api/gps", gpsRoutes);
app.use("/api/sos", sosRoutes);

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
