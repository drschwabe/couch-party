var test = require('tape'),
    requireUncached = require('require-uncached'),
    rimraf = require('rimraf')

//Remove db directory/purge any data from previous test: 
rimraf('./test/pouch', (err) => {
  if(err) return console.log(err)

  //Spin up a db server: 
  var spawnPouchDBServer = require('spawn-pouchdb-server')
  spawnPouchDBServer({
    port: 5988, 
    directory: './test/pouch', 
    log: {
      file: './test/pouch/pouch.log',
    },
    config: {
      file: './test/pouch/config.json'
    }  
  }, (error, dbServer) => {
    if(error) return console.log(error)

    console.log('PouchDB server started on port 5988')

    // ### Start Tests ###

    test.onFinish(() => {
      dbServer.stop(function () {
        console.log('PouchDB Server stopped.')
      })
    })

    var baseDbURL = 'http://localhost:5988/party'

    test('Can register a user', (t) => {
      t.plan(5) 
      var couchParty = requireUncached('./couch-party.js')

      var registrant = {
        nickname : 'Sarah', 
        email : 'sara@geemail.com', 
        password : 'w00t'
      }

      couchParty.register(baseDbURL, registrant, (err, res) => {
        if(err) return t.fail(err)
        console.log(res)
        t.ok(res.user_doc, 'couchParty response has a user_doc')
        t.equals(res.user_doc._id, 'user', 'couchParty user_doc has { _id : "user" }')
        t.ok(res.user_doc.db_id, 'couchParty user_doc has a db_id')
        t.ok(res.user_doc.db_name, 'couchParty user_doc has a db_name')
        //TODO: ensure db_name is prefixed with party_      
        t.ok(res.signup_token, 'couchParty response has a signup_token')

        //TODO: query the db and ensure this info is in there: 
        //t.equals(res.email, 'sara@geemail.com')
        //t.equals(res.password, 'w00t')
        //and that user is not confirmed/verified yet. 
      })
    })
  })
})




