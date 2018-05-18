var test = require('tape')

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
},(error, dbServer) => {
  if(error) return console.log(error)

  console.log('PouchDB server started on port 5988')

  test.onFinish(() => {
    dbServer.stop(function () {
      console.log('PouchDB Server stopped.')
    })
  })
  
  var baseURL

  test('test', (t) => {
    t.plan(1)
    t.equals(2, 1+1)
  })


  test('doing couch.register twice with same email results in err', (t) => {

  })

  test('doing couch.register twice with same nickname results in err', (t) => {

  })

})  



