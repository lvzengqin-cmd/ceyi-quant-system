/**
 * 策奕事件合约AI量化系统 - 后端服务
 * Node.js + Express + SQLite
 */
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'ceyi-quant-jwt-secret-2024';

// 初始化数据库
const db = new Database('./ceyi_quant.db');

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ 数据库初始化 ============
function initDatabase() {
    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
        )
    `);
    
    // 交易记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            order_id TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            period TEXT NOT NULL,
            direction TEXT NOT NULL,
            entry_price REAL NOT NULL,
            exit_price REAL,
            price_diff REAL,
            amount REAL DEFAULT 100,
            breakeven_amount REAL DEFAULT 10,
            profit_rate REAL NOT NULL,
            profit REAL,
            cumulative_profit REAL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            settled_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    
    // 用户设置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
            id TEXT PRIMARY KEY,
            user_id TEXT UNIQUE NOT NULL,
            order_amount REAL DEFAULT 100,
            breakeven_amount REAL DEFAULT 10,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    
    // Webhook配置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS webhook_configs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            period TEXT NOT NULL,
            direction TEXT NOT NULL,
            url TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, period, direction)
        )
    `);
    
    // 系统设置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
    
    // 创建管理员账号
    const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        const adminId = uuidv4();
        const hashedPassword = bcrypt.hashSync('admin123456', 10);
        db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(adminId, 'admin', hashedPassword, 'admin');
        console.log('✅ 管理员账号已创建: admin / admin123456');
    }
    
    console.log('✅ 数据库初始化完成');
}

// ============ 认证中间件 ============
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: '未授权访问' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Token无效或已过期' });
    }
}

function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: '需要管理员权限' });
    }
    next();
}

// ============ 认证接口 ============

// 注册
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
        }
        
        // 检查用户是否存在
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ success: false, error: '用户名已存在' });
        }
        
        // 创建用户
        const userId = uuidv4();
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        db.prepare('INSERT INTO users (id, username, password, email) VALUES (?, ?, ?, ?)')
            .run(userId, username, hashedPassword, email || null);
        
        // 创建用户设置
        db.prepare('INSERT INTO user_settings (id, user_id) VALUES (?, ?)')
            .run(uuidv4(), userId);
        
        // 生成Token
        const token = jwt.sign({ id: userId, username, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({
            success: true,
            message: '注册成功',
            token,
            user: { id: userId, username, role: 'user' }
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ success: false, error: '注册失败' });
    }
});

// 登录
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
        }
        
        // 查找用户
        const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
        if (!user) {
            return res.status(401).json({ success: false, error: '用户名或密码错误' });
        }
        
        // 验证密码
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ success: false, error: '用户名或密码错误' });
        }
        
        // 生成Token
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({
            success: true,
            message: '登录成功',
            token,
            user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ success: false, error: '登录失败' });
    }
});

// 获取用户信息
app.get('/api/auth/profile', authMiddleware, (req, res) => {
    try {
        const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: '用户不存在' });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: '获取用户信息失败' });
    }
});

// ============ 交易接口 ============

// 获取交易记录
app.get('/api/trades', authMiddleware, (req, res) => {
    try {
        const { page = 1, pageSize = 20, period, direction, date, search } = req.query;
        const offset = (page - 1) * pageSize;
        
        let query = 'SELECT * FROM trades WHERE user_id = ?';
        let countQuery = 'SELECT COUNT(*) as total FROM trades WHERE user_id = ?';
        const params = [req.user.id];
        
        if (period && period !== 'all') {
            query += ' AND period = ?';
            countQuery += ' AND period = ?';
            params.push(period);
        }
        if (direction && direction !== 'all') {
            query += ' AND direction = ?';
            countQuery += ' AND direction = ?';
            params.push(direction);
        }
        if (date) {
            query += ' AND date = ?';
            countQuery += ' AND date = ?';
            params.push(date);
        }
        if (search) {
            query += ' AND order_id LIKE ?';
            countQuery += ' AND order_id LIKE ?';
            params.push(`%${search}%`);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(pageSize), offset);
        
        const trades = db.prepare(query).all(...params);
        const countResult = db.prepare(countQuery).get(...params.slice(0, -2));
        
        res.json({
            success: true,
            data: trades,
            total: countResult.total,
            page: parseInt(page),
            pageSize: parseInt(pageSize),
            totalPages: Math.ceil(countResult.total / pageSize)
        });
    } catch (error) {
        console.error('获取交易记录错误:', error);
        res.status(500).json({ success: false, error: '获取交易记录失败' });
    }
});

// 获取统计数据
app.get('/api/trades/stats', authMiddleware, (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 今日统计
        const todayTrades = db.prepare('SELECT * FROM trades WHERE user_id = ? AND date = ?').all(req.user.id, today);
        const todayOrders = todayTrades.length;
        const todayLongCount = todayTrades.filter(t => t.direction === 'long').length;
        const todayShortCount = todayTrades.filter(t => t.direction === 'short').length;
        const todayProfit = todayTrades.filter(t => t.profit !== null).reduce((sum, t) => sum + t.profit, 0);
        
        // 胜率统计
        const settledTrades = db.prepare('SELECT * FROM trades WHERE user_id = ? AND status != ?').all(req.user.id, 'pending');
        const totalTrades = settledTrades.length;
        const winTrades = settledTrades.filter(t => t.status === 'win').length;
        const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) + '%' : '0%';
        
        // 累计利润
        const allSettledTrades = db.prepare('SELECT * FROM trades WHERE user_id = ? AND profit IS NOT NULL').all(req.user.id);
        const totalProfit = allSettledTrades.reduce((sum, t) => sum + t.profit, 0);
        
        res.json({
            success: true,
            data: {
                todayOrders,
                todayLongCount,
                todayShortCount,
                todayProfit,
                winRate,
                totalProfit,
                totalTrades
            }
        });
    } catch (error) {
        console.error('获取统计错误:', error);
        res.status(500).json({ success: false, error: '获取统计数据失败' });
    }
});

// 获取用户设置
app.get('/api/settings', authMiddleware, (req, res) => {
    try {
        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
        res.json({
            success: true,
            data: settings || { order_amount: 100, breakeven_amount: 10 }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: '获取设置失败' });
    }
});

// 更新用户设置
app.put('/api/settings', authMiddleware, (req, res) => {
    try {
        const { order_amount, breakeven_amount } = req.body;
        
        db.prepare(`
            INSERT INTO user_settings (id, user_id, order_amount, breakeven_amount, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                order_amount = excluded.order_amount,
                breakeven_amount = excluded.breakeven_amount,
                updated_at = CURRENT_TIMESTAMP
        `).run(uuidv4(), req.user.id, order_amount || 100, breakeven_amount || 10);
        
        res.json({ success: true, message: '设置已保存' });
    } catch (error) {
        res.status(500).json({ success: false, error: '保存设置失败' });
    }
});

// ============ Webhook接口 ============

// 利润率配置
const PROFIT_RATES = {
    '5m': 0.50,
    '10m': 0.75,
    '30m': 1.00
};

// 处理Webhook信号
app.post('/webhook/:period/:direction', (req, res) => {
    try {
        const { period, direction } = req.params;
        
        if (!['5m', '10m', '30m'].includes(period)) {
            return res.status(400).json({ success: false, error: '无效的周期' });
        }
        if (!['long', 'short'].includes(direction)) {
            return res.status(400).json({ success: false, error: '无效的方向' });
        }
        
        // 获取BTC价格
        const btcPrice = req.body.price || 65000;
        
        // 获取管理员用户
        const adminUser = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin');
        const userId = adminUser ? adminUser.id : null;
        
        if (!userId) {
            return res.status(500).json({ success: false, error: '系统未初始化' });
        }
        
        // 获取用户设置
        const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
        const amount = settings?.order_amount || 100;
        const breakevenAmount = settings?.breakeven_amount || 10;
        
        // 计算当天序号
        const today = new Date().toISOString().split('T')[0];
        const todayTradesCount = db.prepare('SELECT COUNT(*) as count FROM trades WHERE user_id = ? AND date = ?').get(userId, today);
        const seq = todayTradesCount.count + 1;
        
        // 生成订单ID
        const orderId = `CEYI${today.replace(/-/g, '')}${String(seq).padStart(3, '0')}`;
        
        // 创建交易记录
        const tradeId = uuidv4();
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        
        db.prepare(`
            INSERT INTO trades (id, user_id, order_id, date, time, period, direction, entry_price, amount, breakeven_amount, profit_rate, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(tradeId, userId, orderId, today, time, period, direction, btcPrice, amount, breakevenAmount, PROFIT_RATES[period]);
        
        // 模拟结算（异步）
        setTimeout(() => settleTrade(tradeId, btcPrice), parseInt(period) * 60 * 1000);
        
        res.json({
            success: true,
            message: '信号已接收',
            data: { orderId, period, direction, entryPrice: btcPrice }
        });
    } catch (error) {
        console.error('Webhook错误:', error);
        res.status(500).json({ success: false, error: '处理信号失败' });
    }
});

// 结算交易
function settleTrade(tradeId, entryPrice) {
    try {
        // 获取当前BTC价格
        const currentPrice = 65000 + Math.random() * 1000; // 模拟价格
        
        const trade = db.prepare('SELECT * FROM trades WHERE id = ? AND status = ?').get(tradeId, 'pending');
        if (!trade) return;
        
        // 计算价差和利润
        const priceDiff = currentPrice - entryPrice;
        const actualDiff = trade.direction === 'long' ? priceDiff : -priceDiff;
        const profit = trade.amount * trade.profit_rate * (actualDiff / entryPrice);
        
        // 更新交易记录
        db.prepare(`
            UPDATE trades SET
                exit_price = ?,
                price_diff = ?,
                profit = ?,
                status = ?,
                settled_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(currentPrice, priceDiff, profit, profit >= 0 ? 'win' : 'lose', tradeId);
        
        console.log(`✅ 订单 ${trade.order_id} 已结算: ${profit >= 0 ? '盈利' : '亏损'} $${profit.toFixed(2)}`);
    } catch (error) {
        console.error('结算错误:', error);
    }
}

// ============ 管理员接口 ============

// 获取系统统计
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count;
        const totalTrades = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;
        const todayTrades = db.prepare('SELECT COUNT(*) as count FROM trades WHERE date = ?').get(today).count;
        const pendingTrades = db.prepare('SELECT COUNT(*) as count FROM trades WHERE status = ?').get('pending').count;
        
        res.json({
            success: true,
            data: {
                totalUsers,
                activeUsers,
                totalTrades,
                todayTrades,
                pendingTrades
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: '获取统计数据失败' });
    }
});

// 获取用户列表
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { page = 1, pageSize = 20, search, is_active } = req.query;
        const offset = (page - 1) * pageSize;
        
        let query = 'SELECT id, username, email, role, is_active, created_at FROM users WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        const params = [];
        const countParams = [];
        
        if (search) {
            query += ' AND (username LIKE ? OR email LIKE ?)';
            countQuery += ' AND (username LIKE ? OR email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`);
        }
        if (is_active === 'true') {
            query += ' AND is_active = 1';
            countQuery += ' AND is_active = 1';
        } else if (is_active === 'false') {
            query += ' AND is_active = 0';
            countQuery += ' AND is_active = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(pageSize), offset);
        
        const users = db.prepare(query).all(...params);
        const countResult = db.prepare(countQuery).get(...countParams);
        
        res.json({
            success: true,
            data: users,
            total: countResult.total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: '获取用户列表失败' });
    }
});

// 更新用户
app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { is_active, role } = req.body;
        
        db.prepare('UPDATE users SET is_active = ?, role = ? WHERE id = ?')
            .run(is_active !== undefined ? (is_active ? 1 : 0) : 1, role || 'user', id);
        
        res.json({ success: true, message: '用户已更新' });
    } catch (error) {
        res.status(500).json({ success: false, error: '更新用户失败' });
    }
});

// 删除用户
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        
        if (id === req.user.id) {
            return res.status(400).json({ success: false, error: '不能删除自己' });
        }
        
        db.prepare('DELETE FROM trades WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        
        res.json({ success: true, message: '用户已删除' });
    } catch (error) {
        res.status(500).json({ success: false, error: '删除用户失败' });
    }
});

// 获取所有交易（管理员）
app.get('/api/admin/all-trades', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { page = 1, pageSize = 50, date } = req.query;
        const offset = (page - 1) * pageSize;
        
        let query = 'SELECT t.*, u.username FROM trades t JOIN users u ON t.user_id = u.id';
        let countQuery = 'SELECT COUNT(*) as total FROM trades t JOIN users u ON t.user_id = u.id';
        const params = [];
        
        if (date) {
            query += ' WHERE t.date = ?';
            countQuery += ' WHERE t.date = ?';
            params.push(date);
        }
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(pageSize), offset);
        
        const trades = db.prepare(query).all(...params);
        const countResult = db.prepare(countQuery).get(...params.slice(0, -2));
        
        res.json({
            success: true,
            data: trades,
            total: countResult.total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: '获取交易记录失败' });
    }
});

// ============ 健康检查 ============
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 启动服务器 ============
initDatabase();

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║   策奕事件合约AI量化系统 - 后端服务              ║
╠═══════════════════════════════════════════════════╣
║   端口: ${PORT}                                   ║
║   JWT密钥: ${JWT_SECRET.substring(0, 20)}...              ║
╠═══════════════════════════════════════════════════╣
║   Webhook端点:                                   ║
║   - POST /webhook/5m/long   (5分钟做多)          ║
║   - POST /webhook/5m/short  (5分钟做空)          ║
║   - POST /webhook/10m/long  (10分钟做多)         ║
║   - POST /webhook/10m/short (10分钟做空)         ║
║   - POST /webhook/30m/long  (30分钟做多)         ║
║   - POST /webhook/30m/short (30分钟做空)         ║
╠═══════════════════════════════════════════════════╣
║   管理员账号: admin / admin123456                 ║
╚═══════════════════════════════════════════════════╝
    `);
});