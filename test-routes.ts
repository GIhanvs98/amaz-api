import express from 'express';
import receptionRoutes from './src/routes/reception.routes.js';

const app = express();
app.use('/reception', receptionRoutes);

app._router.stack.forEach((r: any) => {
  if (r.route && r.route.path) {
    console.log(r.route.path, r.route.methods);
  } else if (r.name === 'router') {
    r.handle.stack.forEach((hr: any) => {
      console.log('Router:', hr.route.path, hr.route.methods);
    });
  }
});
