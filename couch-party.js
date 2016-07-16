var PouchDB = require('pouchdb'),
    _pouch = require('underpouch'),
    _ = require('underscore'), 
    bcrypt = require('bcrypt')

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
    bcrypt.compare(login.password, doc.password, function(err, res) {
      if(err) return console.log(err)
      if(!res) return callback('Incorrect password.')


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
      doc.created = Math.floor(Date.now() / 1000) //< Unix timestamp in seconds.

      //Apply a secret token: 
      doc.signup_token = require('crypto').randomBytes(64).toString('hex')

      //Encrypt the password: 
      bcrypt.hash(doc.password, 10, function(err, hash) {
        if(err) return console.log(err)
        doc.password = hash
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
            callback(null, doc.signup_token)
          })
        })      
      })
    }
  })
}

couchParty.verify = function(baseURL, signupToken, callback) {
  console.log('verify user...')
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.find(dbUsers, function(doc) { return doc.signup_token == signupToken }, function(doc) {
    if(!doc) return callback('The token is invalid or expired.')    
    //Delete the signup_token
    delete doc.signup_token
    doc.verified = true
    delete doc._rev //< Remove this so we can update the doc in the user db.
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())
    doc._id = 'user' //< Change id to just 'user' to fit the user db doc's model.    
    userDb.get('user', function(err, originalDoc) {
      if(err) return callback(err)
      console.log('here is the originalDoc from userDb: ')
      console.log(originalDoc)
      //Update the rev so we can modfiy this doc: 
      doc._rev = originalDoc._rev
      doc.db_name = originalDoc.db_name
      userDb.put(doc, function(err, res) {
        if(err) {
          console.log(err)
          return callback(err)
        }
        console.log('userDb put success')
        console.log(res)
        doc._rev = res.rev
        if(callback) return callback(null, doc)
        //TODO: remove the unneeded doc.signup_token from the public users db
        //(syncEverybody extends, does not replace the original publicUsersDb doc)
      })        
    })
  })  
}

couchParty.syncEverybody = function(baseURL) {
  //### User database changes ###
  //Listen for changes to the user's databases.
  //(if password or email change happened in user's database,
  //this needs to be applied to master users db (baseName_users))
  var dbUsers = new PouchDB(baseURL + '_users')
  _pouch.all(dbUsers, function(userDocs) {
    if(!_.isArray(userDocs)) userDocs = [userDocs]
    userDocs.forEach(function(userDoc) {
      //Create a new changes feed...
      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id.toLowerCase())
      userDb.changes({live:true, include_docs: true, doc_ids: ['user']})
        .on('change', function(change) {
          console.log('Change to be applied for ' + userDoc.email)
          console.log(change.doc)
          console.log('-------------------')
          //Throw away the id and rev:
          delete change.doc._id
          delete change.doc._rev
          //Apply any relevant changes; overwrite the existing userDoc:
          var updatedDoc = _.extend(userDoc, change.doc)
          //Put in the master users db:
          dbUsers.put(updatedDoc, function(err, res) {
            if(err) return console.log(err)
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
    //Get the userDb: 
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())
    //Remove the doc id so _pouch.extend works: 
    delete doc._id
    //Extend the userDb's "user" doc with the new token:  
    _pouch.extend(userDb, 'user', doc, function(doc) {
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
    var userDb = new PouchDB(baseURL + '_user_' + doc._id.toLowerCase())        
    userDb.put(doc, function(err, res) {
      if(err) {
        console.log(err)
        return callback(err)
      }
      callback(null)
    })
  })
}

couchParty.updatePass = function(baseURL, email, newPass, callback) {
  var dbUsers = new PouchDB(baseURL + '_users') 
  _pouch.findWhere(dbUsers, { email : email }, function(userDoc) {
    //Encrypt the newpass: 
    bcrypt.hash(newPass, 10, function(err, hash) {
      if(err) return console.log(err)
      userDoc.password = hash

      var userDb = new PouchDB(baseURL + '_user_' + userDoc._id.toLowerCase())

      delete userDoc._id //< Delete this so we can do _pouch.extend


      //We apply the change to the userDb which will
      //replicate back to dbUsers via couchParty.syncEverybody.
      _pouch.extend(userDb, 'user', userDoc, function(err, updatedUserDoc) {
        if(err) {
          console.log('error with _pouch.extend / couchParty.updatePass:')
          console.log(err)
          return
        }
        callback(null)
      })    
    })    
  })
}

module.exports = couchParty
