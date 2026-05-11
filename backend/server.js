const express = require('express');
const cors = require('cors');
const { initDB } = require('./database'); 

const targetRoRoute = require('./part_list/targetRoRoute');
const partProcRoute = require('./part_list/partProcRoute');
const mergeRoute = require('./part_list/mergeRoute'); 
const mainFormatRoute = require('./part_list/mainFormatRoute');
const batchRoute = require('./part_list/batchRoute');
const handheldRoute = require('./handheld_part_list/handheldRoute');
const templateRoute = require('./part_list/templateRoute'); 
const assignAddrRoute = require('./handheld_part_list/assignAddrRoute');

const app = express();
app.use(cors());
app.use(express.json());

// Routes สำหรับ TBOS
app.use('/api/part-list', targetRoRoute);
app.use('/api/part-list', partProcRoute);
app.use('/api/part-list', mergeRoute);
app.use('/api/part-list', mainFormatRoute); 
app.use('/api/batches', batchRoute);
app.use('/api/template', templateRoute); 

// Routes สำหรับ Handheld
app.use('/api/handheld', handheldRoute);
app.use('/api/handheld-assign', assignAddrRoute);

const PORT = 3000;
app.listen(PORT, async () => {
  await initDB(); 
  console.log(`Backend Server is running on http://localhost:${PORT}`);
});