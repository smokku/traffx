const StanzaError = require('junction').StanzaError

const tableName = 'RosterItems'
const rosterTable = {
  AttributeDefinitions: [
    { AttributeName: 'User', AttributeType: 'S' },
    { AttributeName: 'jid', AttributeType: 'S' }
  ],
  KeySchema: [
    { AttributeName: 'User', KeyType: 'HASH' },
    { AttributeName: 'jid', KeyType: 'RANGE' }
  ],
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  TableName: tableName
}

/* https://tools.ietf.org/html/rfc6121#section-2
 * roster get/set
 * presence subscription
 * TODO extend disco with jabber:iq:roster
 */
module.exports = function (router) {
  return function roster (req, res, next) {
    var query, items, item
    if (req.is('iq') && (query = req.getChild('query', 'jabber:iq:roster'))) {
      items = query.getChildren('item')
      if (req.attrs.type === 'get') {
        if (items.length) {
          return next(new StanzaError(
            'roster-get cannot contain items',
            'modify',
            'bad-request'
          ))
        }
        try {
          router.storage.query(
            {
              TableName: tableName,
              KeyConditionExpression: '#U = :U',
              ExpressionAttributeNames: { '#U': 'User' },
              ExpressionAttributeValues: { ':U': { S: req.to } }
            },
            (err, data) => {
              if (err) next(err)
              else {
                query = res.c('query', {
                  xmlns: 'jabber:iq:roster',
                  ver: new Date().toISOString() // FIXME!
                })

                for (item of data.Items) {
                  query.c('item', { jid: item.jid.S, name: item.name.S })
                }

                res.send()
              }
            }
          )
        } catch (e) {
          next(e)
        }
      }
      if (req.attrs.type === 'set') {
        try {
          let updates = items.map(item => {
            return router.storage
              .updateItem({
                TableName: tableName,
                Key: { User: { S: req.to }, jid: { S: item.attrs.jid } },
                UpdateExpression: 'SET #name = :name',
                ExpressionAttributeNames: { '#name': 'name' },
                ExpressionAttributeValues: { ':name': { S: item.attrs.name } }
              })
              .promise()
          })
          Promise.all(updates).catch(next).then(() => res.send())
          // FIXME implement push
        } catch (e) {
          next(e)
        }
      }
    } else {
      next()
    }
  }
}

module.exports.createTable = function (dynamo, cb) {
  dynamo.createTable(rosterTable, cb)
}
module.exports.tableName = tableName
