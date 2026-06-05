#!/usr/bin/env python3
"""
策奕量化 - 启动脚本
"""
import os
import sys

# 确保脚本目录
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# 导入并运行
from app import app, socketio

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"""
╔═══════════════════════════════════════════════════╗
║                                                   ║
║     🎯 策奕量化 - 事件合约AI量化系统              ║
║                                                   ║
║     🚀 服务器已启动                                ║
║     📊 访问地址: http://localhost:{port}           ║
║     📋 API文档: http://localhost:{port}/api/health ║
║                                                   ║
║     🔗 Webhook端点:                                ║
║       /api/webhook/5m/long  - 5分钟做多            ║
║       /api/webhook/5m/short - 5分钟做空            ║
║       /api/webhook/10m/long - 10分钟做多           ║
║       /api/webhook/10m/short- 10分钟做空           ║
║       /api/webhook/30m/long - 30分钟做多           ║
║       /api/webhook/30m/short- 30分钟做空           ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    """)
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)