'use strict'
import test from 'ava'
import { stanza, JID } from 'node-xmpp-core'
import Router from '../modules/router'
import path from 'path'
import bunyan from 'bunyan'

const testName = path.basename(__filename, '.js')
const log = bunyan.createLogger({ name: testName, level: bunyan.FATAL + 1 })
var router

const uniq = function () {
  return Math.random().toString(36).substring(7)
}

test.cb.before(t => {
  router = new Router({ db: 1, prefix: testName, dumpExceptions: false, log })
  router.iq = function (stanza) {
    stanza = stanza.root()
    let from = stanza.to || new JID(stanza.from).bare().toString()
    return new Promise((resolve, reject) => {
      const response = router.iqResponse(from, stanza)
      response.send = function () {
        resolve(this)
      }
      this.user.handle(stanza, response, reject)
    })
  }
  t.end()
})

async function serviceUnavailable (t, stanza) {
  const id = uniq()
  stanza.id = id
  const res = await router.iq(stanza)
  t.is(res.attrs.type, 'error')
  t.is(res.attrs.id, id)
  const err = res.getChild('error')
  t.truthy(err)
  t.is(err.attrs.type, 'cancel')
  t.truthy(
    err.getChild('service-unavailable', 'urn:ietf:params:xml:ns:xmpp-stanzas')
  )
}

test(
  'dummy:service - no "to"',
  serviceUnavailable,
  stanza`
<iq type="get" from="user@localhost/res">
  <query xmlns="dummy:service">
    <foo xmlns="bar"/>
  </query>
</iq>`
)

test(
  'dummy:service - with "to"',
  serviceUnavailable,
  stanza`
  <iq type="get" from="user@localhost/res" to="user@localhost">
    <query xmlns="dummy:service">
      <foo xmlns="bar"/>
    </query>
  </iq>`
)

test(
  'jabber:iq:private',
  serviceUnavailable,
  stanza`
  <iq type="get" from="user@localhost/res">
    <query xmlns="jabber:iq:private">
      <foo xmlns="bar"/>
    </query>
  </iq>`
)
