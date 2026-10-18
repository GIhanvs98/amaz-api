const fs = require('fs');
let content = fs.readFileSync('src/app.ts', 'utf8');
content = content.replace(/import staffRoutes from "\.\/routes\/staff.routes.js";\nimport hrRoutes from "\.\/routes\/hr.routes.js";\nimport staffRoutes from "\.\/routes\/staff.routes.js";\nimport hrRoutes from "\.\/routes\/hr.routes.js";/g, 'import staffRoutes from "./routes/staff.routes.js";\nimport hrRoutes from "./routes/hr.routes.js";');
content = content.replace(/app.use\("\/api\/staff", staffRoutes\);\napp.use\("\/api\/hr", hrRoutes\);\napp.use\("\/api\/staff", staffRoutes\);\napp.use\("\/api\/hr", hrRoutes\);/g, 'app.use("/api/staff", staffRoutes);\napp.use("/api/hr", hrRoutes);');
fs.writeFileSync('src/app.ts', content);
