'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'
import Router from '../modules/router'
import path from 'path'
import net from 'net'
import crypto from 'crypto'
import bunyan from 'bunyan'

const testName = path.basename(__filename, '.js')
const log = bunyan.createLogger({ name: testName, level: bunyan.FATAL + 1 })
const router = new Router({ db: 1, prefix: testName, log })
const tcp = new C2S.TCPServer({ port: 10000 + process.pid })
const ws = new C2S.WebSocketServer({ port: 10001 + process.pid })

function clientTest (t, opts) {
  t.plan(6)

  var websocket

  const c2s = new ModC2S(opts)
  if (c2s.server.WS) {
    websocket = { url: `ws://localhost:${opts.server.port}/xmpp-websocket` }
    t.plan(6)
  } else {
    t.plan(7)
  }

  c2s.server.on('connection', connection => {
    // does not happen on empty TCP connect/disconnect on WebSocket
    t.pass('connection')
  })

  c2s.server.on('online', () => {
    t.pass('online')

    const jid = Math.random().toString(36).substring(7) + '@localhost'

    const client = new xmpp.Client({
      autostart: false,
      port: opts.server.port,
      jid,
      password: 'password',
      websocket
    })

    client.on('error', t.end)

    client.on('online', sess => {
      t.is(sess.jid.bare().toString(), jid)
      client.end()
    })

    client.on('end', t.end)

    // test empty connect/disconnect first
    const conn = new net.Socket()
    conn.connect(opts.server.port, '127.0.0.1', () => {
      t.pass('connect')
      // push some random garbage
      conn.write(crypto.randomBytes(2048))
      // and disconnect
      conn.destroy()
    })
    conn.on('close', () => {
      t.pass('disconnect')
      // now connect real client
      client.connect()
    })
  })

  c2s.server.listen(err => {
    t.ifError(err, 'listen')
  })
}

// eslint-disable-next-line ava/test-ended
test.cb('client:tcp', clientTest, { server: tcp, router, log, autostart: false })
// eslint-disable-next-line ava/test-ended
test.cb('client:ws', clientTest, { server: ws, router, log, autostart: false })
