var PouchDB = require('pouchdb'),
    _pouch = require('underpouch'),
    _ = require('underscore')

var couchParty = {}

couchParty.login = function(baseURL, login, callback) {
  //^ string, object, function
  //baseURL parameter should have format like: "http://admin:admin@localhost:5984/myproject" 
  //Find the id which corresponds to the nickname...
  var dbUsers = new PouchDB(baseURL + '_users')
  //^ "_users" part appended automatically, 
  //which results in a db name of ie: "myproject_users"
  _pouch.find(dbUsers, function(doc) { return doc.nickname == login.nickOrEmail || doc.email == login.nickOrEmail }, function(doc) {

    //If user does not exist:
    if(_.isUndefined(doc)) return callback('No user with that nickname or email.')

    //Password check:
    if(login.password != doc.password) return callback('Incorrect password.')

    //Now connect to the corresponding (existing) database
    //which is based on the user's couch generated hash (but in lower case)
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())    
    userDb.get('user', function(err, userDoc) {
      if(err) return callback(err)
      //Merge in the email and nickname from the previous doc:
      userDoc = _.extend(doc, userDoc)
      callback(null, userDoc)
    })
  })
}

couchParty.register = function(baseURL, login, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')

  //Check for existing user based on email address: 
  _pouch.find(dbUsers, function(doc) { return doc.email == login.email }, function(doc) {
    //If user exists:
    if(doc) {
      return callback('A user with that email already exists.')
    } else {
      //Creates a doc in the "baseName_users" database:
      doc = login
      doc.verified = false
      dbUsers.post(doc, function(err, res) {
        if(err) return console.log(err)
        console.log(res)
        doc._id = res.id
        //Now create a unique database for the user:
        var userDbName = baseURL + '_user_' + doc._id.toLowerCase()
        var baseName = userDbName.split("/").pop() //< Strip out the address. 
        var userDb = new PouchDB(userDbName)
        userDb.post({ _id: 'user', db_name: baseName }, function(err, res) {
          if(err) return console.log(err)
          console.log(res)
          callback(null, res)
        })
      })
    }
  })
}

couchParty.syncEverybody = function(baseURL) {
  //### User database changes ###
  //Listen for changes to the user's databases.
  //(if password or email change happened in user's database,
  //this needs to be applied to master users db (baseName_users))
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.pluck(dbUsers, function(userDocs) {
    if(!_.isArray(userDocs)) userDocs = [userDocs]
    userDocs.forEach(function(userDoc) {
      //Create a new changes feed...
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id.toLowerCase())
      userDb.changes({live:true, include_docs: true, doc_ids: ['user']})
            .on('change', function(change) {
             console.log('Change to be applied for ' + userDoc.email)
              //Throw away the id and rev:
              delete change.doc._id
              delete change.doc._rev
              //Apply any relevant changes.
              var updatedDoc = _.chain(userDoc)
                                //Overwrite the existing userDoc:
                                .extend(change.doc)
                                //Only pick certain fields to avoid
                                //giving masters db more than it needs:
                                .pick('_id', '_rev', 'password', 'email', 'nickname', 'verified')
                                .value()
              //Put in the master users db:
              dbUsers.put(updatedDoc, function(err, res) {
                if(err) console.log(err)
                console.log(res)
                //Update the rev so this process works again next change:
                userDoc._rev = res.rev
              })
            })
            .on('error', function (err) {
              console.log(err)
            })
    })
  })
}
//TODO: make an alias for "resetLink"
couchParty.resetToken = function(baseURL, email, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')    
  var secretToken = require('crypto').randomBytes(64).toString('hex')
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.find(dbUsers, function(doc) { return doc.email == email }, function(doc) {
    if(_.isUndefined(doc)) return callback('No user with that email exists.')
    //Apply the token to the user's db...
    doc.secret_token = secretToken
    dbUsers.put(doc, function(err, res) {
      if(err) {
        console.log(err) 
        return callback(err)
      }
      //and now send the token back: 
      callback(null, secretToken)      
    })
  })
}

couchParty.resetPass = function(baseURL, secretToken, newPass, callback) {
  var dbUsers = new PouchDB(baseURL + '_users')  
  _pouch.find(dbUsers, function(doc) { return doc.secret_token == secretToken }, function(doc) {
    if(!doc) return callback('The token is invalid or expired.')
    doc.password = newPass
    delete doc.secret_token
    dbUsers.put(doc, function(err, res) {
      if(err) {
        console.log(err)
        return callback(err)
      }
      callback(null)
    })
  })
}

module.exports = couchParty
