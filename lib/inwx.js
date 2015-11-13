/*!
 * inwx 1.0.0
 * https://github.com/mattes/inwx-nodejs
 *
 * Copyright 2012 Matthias Kadenbach
 * Released under the MIT license
 *
 *
 * INWX XML-RPC API DOC:
 * https://www.inwx.de/de/help#key=20
 * https://www.inwx.de/de/download/file/api-current.zip (logged in inwx customers only)
 */

var xmlrpc = require('xmlrpc');

/*
 * init inwx api and call readyCallback when ready
 * @param opts            {api: production|testing, user: string, password: string}
 * @param readyCallback   call when api is ready
 */
function inwx(opts, readyCallback) {
  this.connected = false;
  var that = this;

  // Invokes with new if called without
  if (false === (this instanceof inwx)) {
    return new inwx(opts, readyCallback);
  }

  if(!opts.user || !opts.password) throw new Error("missing user and/or password");
  if(!opts.host) opts.host = opts.api == "production" ? "api.domrobot.com" : "api.ote.domrobot.com";

  this.client = xmlrpc.createSecureClient({ host: opts.host, path: "/xmlrpc/", cookies: true });

  this.call("account", "login", {user: opts.user, pass: opts.password}, function(response) {
    this.connected = true;
    readyCallback.call(this, that);
  });

  return that;
}

/*
 * make remote xmlrpc api call
 * @param object            object to call (see inwx api doc)
 * @param method            method to call (see inwx api doc)
 * @param params            {key: value[, ...]}
 * @param successCallback   call when api call was successful
 * @param errorCallback     call on error (optional)
 */
inwx.prototype.call = function call(object, method, params, successCallback, errorCallback) {
  if(!object) throw new Error("missing object for xmlrpc call");
  if(!method) throw new Error("missing method for xmlrpc call");

  this.client.methodCall(object + "." + method, [ params ], function(error, response){
    if(error) {
      // xmlrpc error
      if(errorCallback) {
        errorCallback.call(this, error);
      } else {
        throw new Error(error.faultString);
      }
    } else {
      if(response.code == "1000") {
        // no errors
        if(successCallback) successCallback.call(this, response.resData);
      } else {
        // error from inwx error?
        if(errorCallback) {
          errorCallback.call(this, response);
        } else {
          var additionalReason = response.reason ? " + " + response.reason + "(AdditionalCode " + response.reasonCode + ")": "";
          console.error("ERROR: " + object + "." + method + "(" + JSON.stringify(params) + ") returned: " + response.msg + " (Code " + response.code + ")" + (additionalReason ? additionalReason : ""));
        }
      }
    }
  });
};

/*
 * logout from api
 */
inwx.prototype.close = function close() {
  if(this.connected) this.call("account", "logout");
}



/*
 * a helper method for nameserver operations
 * @param domain                  existing domain from your nameserver sets
 * @param command                 create|update|delete
 * @param opt1, opt2, opt3, opt4  changes depending on command, see examples below
 *
 * examples:
 * nameserverRecordHelper("example.com", "create", {key: value[, ...]}, successCallback, errorCallback)
 * nameserverRecordHelper("example.com", "update", {key: value[, ...]}, {where_key: value[, ...]}, successCallback, errorCallback)
 * nameserverRecordHelper("example.com", "delete", {where_key: value[, ...]}, successCallback, errorCallback)
 *
 * successCallback and errorCallback are optional
 *
 * SOA revision number is updated automatically by inwx
 */
inwx.prototype.nameserverRecordHelper = function nameserverRecordHelper(domain, command, opt1, opt2, opt3, opt4) {
  var that = this;
  switch(command) {

    case "create":
      var values = opt1, successCallback = opt2, errorCallback = opt3;
      if(!values) throw new Error("missing values parameter");

      values.domain = domain;
      this.call("nameserver", "createRecord", values, successCallback, errorCallback);
      break;

    case "update":
      var values = opt1, where = opt2, successCallback = opt3, errorCallback = opt4;
      if(!values) throw new Error("missing values parameter");
      if(!where) throw new Error("missing where parameter");

      this.call("nameserver", "info", {domain: domain}, function(nameserverRecords) {
        if(!nameserverRecords.count > 0) successCallback.call(this, []);

        // find matches in existing nameserver records
        var updateRecords = that._findAndReturnMatchesInNameserverRecords(where, nameserverRecords.record);
        var updateRecordsLength = updateRecords.length;
        if(!updateRecordsLength > 0) successCallback.call(this, []);

        // update found matches
        if(updateRecordsLength > 0) {
          var updatedRecordIds = [];
          var callbackCounter = 0;
          updateRecords.forEach(function(record) {
            updatedRecordIds.push(record.id);
            var updateValues = values;
            updateValues.id = record.id;
            that.call("nameserver", "updateRecord", updateValues, function(){
              callbackCounter++;
              if(callbackCounter == updateRecordsLength) {
                // as soon as last record was updated, fetch updated records and return them
                // @todo: add timeout, if callbackCounter does not reach updateRecordsLength

                that.call("nameserver", "info", {domain: domain}, function(nameserverRecords) {
                  if(!nameserverRecords.count > 0) throw new Error("oh, i updated nameserver records and now everything is gone?!");

                  var updatedRecords = [];
                  nameserverRecords.record.forEach(function(record){
                    if(updatedRecordIds.indexOf(record.id) >= 0) updatedRecords.push(record);
                  });
                  successCallback.call(that, updatedRecords);
                });
              }
            });
          });
        }
      });
      break;

    case "delete":
      var where = opt1, successCallback = opt2, errorCallback = opt3;
      if(!where) throw new Error("missing where parameter");

      this.call("nameserver", "info", {domain: domain}, function(nameserverRecords) {
        if(!nameserverRecords.count > 0) successCallback.call(this, []);

        // find matches in existing nameserver records
        var deleteRecords = that._findAndReturnMatchesInNameserverRecords(where, nameserverRecords.record);
        var deleteRecordsLength = deleteRecords.length;
        if(!deleteRecordsLength > 0) successCallback.call(this, []);

        // delete found matches
        if(deleteRecordsLength > 0) {
          var callbackCounter = 0;
          deleteRecords.forEach(function(record) {
            that.call("nameserver", "deleteRecord", {id: record.id}, function(){
              callbackCounter++;
              if(callbackCounter == deleteRecordsLength) {
                // as soon as last record was deleted, call callback
                // @todo: add timeout, if callbackCounter does not reach deleteRecordsLength
                successCallback.call(that, deleteRecords);
              }
            });
          });
        }
      });
      break;
  }
}

/*
 * internal helper to find matches in nameserver records
 * @param where               {where_key: value[, ...]}
 * @param nameserverRecords   [ {record}[, {...}] ]
 */
inwx.prototype._findAndReturnMatchesInNameserverRecords = function _findAndReturnMatchesInNameserverRecords(where, nameserverRecords) {
  var foundRecords = [];
  var whereKeys = Object.keys(where);
  var whereKeysLength = whereKeys.length;
  nameserverRecords.forEach(function(record) {
    var foundFlag = 0;
    whereKeys.forEach(function(key){
      if(record[key] == where[key]) foundFlag++;
    });
    if(foundFlag == whereKeysLength) foundRecords.push(record);
  });
  return foundRecords;
}




module.exports = inwx;
