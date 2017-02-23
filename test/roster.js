'use strict'
import test from 'ava'
import xmpp from 'node-xmpp-client'
import Router from '../modules/router'
import { createTable, tableName } from '../modules/roster'
import path from 'path'
import DynamoDB from 'aws-sdk/clients/dynamodb'

const testName = path.basename(__filename, '.js')
var dynalite
var router

test.cb.before(t => {
  var dynaPort = 10000 + process.pid
  dynalite = require('dynalite')()
  dynalite.listen(dynaPort, err => {
    t.ifError(err)
    var dynamo = new DynamoDB({
      region: 'us-west-2',
      apiVersion: '2012-08-10',
      endpoint: 'http://localhost:' + dynaPort
    })
    function checkTable (err, data) {
      t.ifError(err)
      var status = (data.Table || data.TableDescription).TableStatus
      if (status !== 'ACTIVE') {
        setTimeout(
          dynamo.describeTable.bind(
            dynamo,
            { TableName: tableName },
            checkTable
          ),
          100
        )
      } else {
        router = new Router({
          db: 1,
          prefix: testName,
          storage: dynamo,
          dumpExceptions: false
        })
        router.iq = function (stanza) {
          stanza = stanza.root()
          return new Promise((resolve, reject) => {
            const response = router.iqResponse(stanza.to, stanza)
            response.send = function () {
              resolve(this)
            }
            this.user.handle(stanza, response, reject)
          })
        }
        t.end()
      }
    }
    createTable(dynamo, checkTable)
  })
})

function iq (type, seq = 1) {
  return new xmpp.Stanza('iq', {
    to: 'roster@localhost',
    from: 'roster@localhost/res',
    type,
    id: `${type}_${seq}`
  }).c('query', { xmlns: 'jabber:iq:roster' })
}

test('roster get empty', async t => {
  t.plan(8)

  const get = iq('get')
  const res1 = await router.iq(get)
  t.is(res1.attrs.type, 'result')
  t.is(res1.attrs.id, 'get_1')
  const query1 = res1.getChild('query', 'jabber:iq:roster')
  t.truthy(query1)
  const items1 = query1.getChildren('item')
  t.is(items1.length, 0)
  get.c('item')
  const res2 = await router.iq(get)
  t.is(res2.attrs.type, 'error')
  const err2 = res2.getChild('error')
  t.truthy(err2)
  t.is(err2.attrs.type, 'modify')
  t.truthy(err2.getChild('bad-request', 'urn:ietf:params:xml:ns:xmpp-stanzas'))
})

test('roster set/get', async t => {
  t.plan(7)

  const set1 = iq('set').c('item', { jid: 'one@example.com', name: 'One' })
  const res1 = await router.iq(set1)
  t.is(res1.attrs.type, 'result')
  t.is(res1.attrs.id, 'set_1')
  const get2 = iq('get', 2)
  const res2 = await router.iq(get2)
  t.is(res2.attrs.type, 'result')
  t.is(res2.attrs.id, 'get_2')
  const query2 = res2.getChild('query', 'jabber:iq:roster')
  t.truthy(query2)
  t.truthy(query2.attrs.ver)
  const items2 = query2.getChildren('item')
  t.is(items2.length, 1)
})
