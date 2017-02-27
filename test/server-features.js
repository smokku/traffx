'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import { C2S } from 'node-xmpp-server'
import ModC2S from '../modules/c2s'
import Router from '../modules/router'
import path from 'path'
import os from 'os'

const pjson = require('../package.json')
const port = 10000 + process.pid
const testName = path.basename(__filename, '.js')
const router = new Router({ db: 1, prefix: testName })
const tcp = new C2S.TCPServer({ port })
const c2s = new ModC2S({ server: tcp, router })
const uniq = function () { return Math.random().toString(36).substring(7) }

test.cb.beforeEach(t => {
  t.context.client = new xmpp.Client({
    port,
    jid: uniq() + '@localhost',
    password: 'password'
  })
  t.context.client.on('online', sess => {
    t.context.session = sess
    t.end()
  })
})

test.cb.afterEach(t => {
  t.context.client.on('end', t.end)
  t.context.client.end()
})

c2s.server.on('online', () => {
  test.cb('urn:xmpp:ping', t => {
    let client = t.context.client
    client.on('error', t.end)
    let id = uniq()
    let iq = new xmpp.IQ({
      id,
      type: 'get',
      to: t.context.session.jid.domain
    })
    iq.c('ping', { xmlns: 'urn:xmpp:ping' })
    client.send(iq)
    client.on('stanza', stanza => {
      t.is(id, stanza.attrs.id)
      t.is(t.context.session.jid.domain, stanza.attrs.from)
      t.is('result', stanza.attrs.type)
      t.end()
    })
  })

  test.cb('jabber:iq:version', t => {
    let client = t.context.client
    client.on('error', t.end)
    let id = uniq()
    let iq = new xmpp.IQ({
      id,
      type: 'get',
      to: t.context.session.jid.domain
    })
    iq.c('query', { xmlns: 'jabber:iq:version' })
    client.send(iq)
    client.on('stanza', stanza => {
      t.is(id, stanza.attrs.id)
      t.is(t.context.session.jid.domain, stanza.attrs.from)
      t.is('result', stanza.attrs.type)
      let query = stanza.getChild('query', 'jabber:iq:version')
      t.truthy(query)
      t.is(query.children.length, 3)
      let n = query.children.find(it => it.name === 'name')
      let v = query.children.find(it => it.name === 'version')
      let o = query.children.find(it => it.name === 'os')
      t.truthy(n)
      t.truthy(v)
      t.truthy(o)
      t.is(n.children[0], pjson.name)
      t.is(v.children[0], pjson.version)
      t.is(o.children[0], os.type())
      t.end()
    })
  })

  test.cb('jabber:iq:last', t => {
    let client = t.context.client
    client.on('error', t.end)
    let id = uniq()
    let iq = new xmpp.IQ({
      id,
      type: 'get',
      to: t.context.session.jid.domain
    })
    iq.c('query', { xmlns: 'jabber:iq:last' })
    client.send(iq)
    client.on('stanza', stanza => {
      t.is(id, stanza.attrs.id)
      t.is(t.context.session.jid.domain, stanza.attrs.from)
      t.is('result', stanza.attrs.type)
      let query = stanza.getChild('query', 'jabber:iq:last')
      t.truthy(query)
      t.truthy(query.attrs.seconds)
      t.end()
    })
  })

  test.cb('urn:xmpp:time', t => {
    let client = t.context.client
    client.on('error', t.end)
    let id = uniq()
    let iq = new xmpp.IQ({
      id,
      type: 'get',
      to: t.context.session.jid.domain
    })
    iq.c('time', { xmlns: 'urn:xmpp:time' })
    client.send(iq)
    client.on('stanza', stanza => {
      t.is(id, stanza.attrs.id)
      t.is(t.context.session.jid.domain, stanza.attrs.from)
      t.is('result', stanza.attrs.type)
      let query = stanza.getChild('time', 'urn:xmpp:time')
      t.truthy(query)
      t.is(query.children.length, 2)
      let utc = query.children.find(it => it.name === 'utc')
      let tzo = query.children.find(it => it.name === 'tzo')
      t.truthy(utc)
      t.truthy(tzo)
      t.truthy(utc.children[0])
      t.truthy(tzo.children[0])
      t.end()
    })
  })
})
