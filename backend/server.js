// ไฟล์: backend/server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { initDB } = require('./database');
const { initSocketHub } = require('./lib/socketHub');

const targetRoRoute = require('./part_list/targetRoRoute');
const partProcRoute = require('./part_list/partProcRoute');
const mainFormatRoute = require('./part_list/mainFormatRoute');
const groupPrefixHistoryRoute = require('./part_list/groupPrefixHistoryRoute');
const activeBatchRoute = require('./part_list/activeBatchRoute');
const batchRoute = require('./part_list/batchRoute');
const handheldRoute = require('./handheld_part_list/handheldRoute');
const templateRoute = require('./part_list/templateRoute');
const assignAddrRoute = require('./handheld_part_list/assignAddrRoute');
const deviceRoute = require('./handheld_part_list/deviceRoute');
const ltboImportRoute = require('./ltbo/ltboImportRoute');
const processStockRoute = require('./processStock/processStockRoute');
const zoneDefinitionRoute = require('./handheld_part_list/zoneDefinitionRoute');
const deviceAssignmentRoute = require('./handheld_part_list/deviceAssignmentRoute');
const getsudoRoute = require('./getsudo/getsudoRoute');

const app = express();
app.use(cors());

// 🔴 แก้ไขจุดนี้: ขยายประตูหน้าบ้านให้รับข้อมูล JSON และ Form ก้อนใหญ่ระดับ 50MB ได้
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes สำหรับ TBOS
app.use('/api/part-list', targetRoRoute);
app.use('/api/part-list', partProcRoute);
app.use('/api/part-list', mainFormatRoute);
app.use('/api/part-list', groupPrefixHistoryRoute);
app.use('/api/part-list', activeBatchRoute);
app.use('/api/batches', batchRoute);
app.use('/api/template', templateRoute);

// Routes สำหรับ Handheld
app.use('/api/handheld', handheldRoute);
app.use('/api/handheld-assign', assignAddrRoute);
app.use('/api/handheld-assign', deviceAssignmentRoute);
app.use('/api/handheld-devices', deviceRoute);
app.use('/api/ltbo', ltboImportRoute);
app.use('/api/process-stock', processStockRoute);
app.use('/api/zone-definitions', zoneDefinitionRoute);
app.use('/api/getsudo', getsudoRoute);

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
initSocketHub(io);

const PORT = 3000;
httpServer.listen(PORT, async () => {
  await initDB();
  console.log(`Backend Server is running on http://localhost:${PORT}`);
});