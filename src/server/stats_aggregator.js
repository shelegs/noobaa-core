/* jshint node:true */
'use strict';

/*
 * Stats Aggregator Server
 */

var stats_aggregator = {
    //stats getters
    get_systems_stats: get_systems_stats,
    get_nodes_stats: get_nodes_stats,
    get_ops_stats: get_ops_stats,
    get_all_stats: get_all_stats,

    //OP stats collection
    register_histogram: register_histogram,
    add_sample_point: add_sample_point,
};

module.exports = stats_aggregator;

var _ = require('lodash');
var Q = require('q');
var request = require('request');
var formData = require('form-data');
var util = require('util');
var db = require('./db');
var promise_utils = require('../util/promise_utils');
var histogram = require('../util/histogram');
var dbg = require('../util/debug_module')(__filename);
var config = require('../../config.js');
var system_server = require('./system_server');
var bucket_server = require('./bucket_server');
var tier_server = require('./tier_server');
var account_server = require('./account_server');
var node_server = require('./node_server');
var object_mapper = require('./object_mapper');
var cluster_server = require('./cluster_server');


var support_account;
var ops_aggregation = {};
var SCALE_BYTES_TO_GB = 1024 * 1024 * 1024;
var SCALE_SEC_TO_DAYS = 60 * 60 * 24;

/*
 * Stats Collction API
 */
var SYSTEM_STATS_DEFAULTS = {
    clusterid: '',
    version: '',
    agent_version: '',
    count: 0,
    systems: [],
};

var SINGLE_SYS_DEFAULTS = {
    tiers: 0,
    buckets: 0,
    chunks: 0,
    objects: 0,
    roles: 0,
    allocated_space: 0,
    used_space: 0,
    total_space: 0,
    associated_nodes: 0,
    properties: {
        on: 0,
        off: 0,
    },
};

//Collect systems related stats and usage
function get_systems_stats(req) {
    var sys_stats = _.cloneDeep(SYSTEM_STATS_DEFAULTS);
    sys_stats.version = process.env.CURRENT_VERSION || 'Unknown';
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';

    return Q.fcall(function() {
            return cluster_server.get_cluster_id();
        })
        .then(function(clusterid) {
            sys_stats.clusterid = clusterid;
            //Get ALL systems
            return system_server.list_systems_int(true, true);
        })
        .then(function(res) {
            sys_stats.count = res.systems.length;
            for (var i = 0; i < sys_stats.count; ++i) {
                sys_stats.systems.push(_.cloneDeep(SINGLE_SYS_DEFAULTS));
            }
            //Per each system fill out the needed info
            return Q.all(_.map(res.systems, function(sys, i) {
                return Q.fcall(function() {
                        return tier_server.list_tiers({
                            system: sys,
                        });
                    })
                    .then(function(tiers) {
                        sys_stats.systems[i].tiers = tiers.length;
                        return bucket_server.list_buckets({
                            system: sys
                        });
                    })
                    .then(function(buckets) {
                        sys_stats.systems[i].buckets = buckets.buckets.length;
                        return object_mapper.chunks_and_objects_count(sys.id);
                    })
                    .then(function(objects) {
                        sys_stats.systems[i].chunks = objects.chunks_num;
                        sys_stats.systems[i].objects = objects.objects_num;
                        return account_server.get_system_roles({
                            system: sys
                        });
                    })
                    .then(function(accounts) {
                        sys_stats.systems[i].roles = accounts.length;
                        return system_server.read_system({
                            system: sys
                        });
                    })
                    .then(function(res_system) {
                        sys_stats.systems[i].allocated_space = res_system.storage.alloc;
                        sys_stats.systems[i].used_space = res_system.storage.used;
                        sys_stats.systems[i].total_space = res_system.storage.total;
                        sys_stats.systems[i].associated_nodes = res_system.nodes.count;
                        sys_stats.systems[i].properties.on = res_system.nodes.online;
                        sys_stats.systems[i].properties.off = res_system.nodes.count - res_system.nodes.online;
                        return sys_stats;
                    });
            }));
        })
        .then(null, function(err) {
            dbg.log0('Error in collecting systems stats, skipping current sampling point', err);
            throw new Error('Error in collecting systems stats');
        });
}

var NODES_STATS_DEFAULTS = {
    count: 0,
    os: {
        win: 0,
        osx: 0,
        linux: 0,
        other: 0,
    },
};


//Collect nodes related stats and usage
function get_nodes_stats(req) {
    var nodes_stats = _.cloneDeep(NODES_STATS_DEFAULTS);
    var nodes_histo = get_empty_nodes_histo();
    return Q.fcall(function() {
            //Get ALL systems
            return system_server.list_systems_int(true, true);
        })
        .then(function(res) {
            //Per each system fill out the needed info
            return Q.all(_.map(res.systems, function(sys, i) {
                    return Q.fcall(function() {
                        return node_server.list_nodes_int({}, sys.id);
                    });
                }))
                .then(function(results) {
                    for (var isys = 0; isys < results.length; ++isys) {
                        for (var inode = 0; inode < results[isys].nodes.length; ++inode) {
                            nodes_stats.count++;

                            nodes_histo.histo_allocation.add_value(results[isys].nodes[inode].storage.alloc / SCALE_BYTES_TO_GB);
                            nodes_histo.histo_usage.add_value(results[isys].nodes[inode].storage.used / SCALE_BYTES_TO_GB);
                            nodes_histo.histo_free.add_value(results[isys].nodes[inode].storage.free / SCALE_BYTES_TO_GB);
                            nodes_histo.histo_uptime.add_value((results[isys].nodes[inode].os_info.uptime / SCALE_SEC_TO_DAYS));

                            if (results[isys].nodes[inode].os_info.ostype === 'Darwin') {
                                nodes_stats.os.osx++;
                            } else if (results[isys].nodes[inode].os_info.ostype === 'Windows_NT') {
                                nodes_stats.os.win++;
                            } else if (results[isys].nodes[inode].os_info.ostype === 'Linux') {
                                nodes_stats.os.linux++;
                            } else {
                                nodes_stats.os.other++;
                            }
                        }
                    }
                    for (var h in nodes_histo) {
                        if (nodes_histo.hasOwnProperty(h)) {
                            nodes_stats[nodes_histo[h].get_master_label()] = nodes_histo[h].get_object_data(false);
                        }
                    }
                    return nodes_stats;
                });
        })
        .then(null, function(err) {
            dbg.log0('Error in collecting nodes stats, skipping current sampling point', err);
            throw new Error('Error in collecting nodes stats');
        });
}

function get_ops_stats(req) {
    var ops_stats = {};
    for (var op in ops_aggregation) {
        if (ops_aggregation.hasOwnProperty(op)) {
            ops_stats[op] = ops_aggregation[op].get_string_data();
        }
    }
    return ops_stats;
}

//Collect operations related stats and usage
function get_all_stats(req) {
    //var self = this;
    var stats_payload = {
        sys_stats: null,
        nodes_stats: null,
        ops_stats: null,
    };

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN');
    return Q.fcall(function() {
            return get_support_account_id();
        })
        .then(function() {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Systems');
            return get_systems_stats(req);
        })
        .then(function(sys_stats) {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
            stats_payload.sys_stats = sys_stats;
            return get_nodes_stats(req);
        })
        .then(function(node_stats) {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops (STUB)'); //TODO
            stats_payload.node_stats = node_stats;
            return get_ops_stats(req);
        })
        .then(function(ops_stats) {
            stats_payload.ops_stats = ops_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'SENDING (STUB)'); //TODO
        })
        .then(function() {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
            return stats_payload;
        })
        .then(null, function(err) {
            return {};
        });
}

/*
 * OPs stats collection
 */
function register_histogram(opname, master_label, structure) {
    if (typeof(opname) === 'undefined' || typeof(structure) === 'undefined') {
        dbg.log0('register_histogram called with opname', opname, 'structure', structure, 'skipping registration');
        return;
    }

    if (!ops_aggregation.hasOwnProperty(opname)) {
        ops_aggregation[opname] = new histogram(master_label, structure);
    }

    dbg.log2('register_histogram registered', opname, '-', master_label, 'with', structure);
}

function add_sample_point(opname, duration) {
    if (typeof(opname) === 'undefined' || typeof(duration) === 'undefined') {
        dbg.log0('add_sample_point called with opname', opname, 'duration', duration, 'skipping sampling point');
        return;
    }

    if (!ops_aggregation.hasOwnProperty(opname)) {
        dbg.log0('add_sample_point called without histogram registered (', opname, '), skipping');
        return;
    }

    ops_aggregation[opname].add_value(duration);
}

/*
 * UTILS
 */
function get_support_account_id() {
    return db.Account
        .findOne({
            email: 'support@noobaa.com',
            deleted: null,
        })
        .exec()
        .then(function(account_arg) {
            support_account = account_arg;
        })
        .then(null, function(err) {
            dbg.log0('Error in getting support account', err);
        });
}

function send_stats_payload(payload) {
    var form = new formData();
    form.append('phdata', JSON.stringify(payload));

    return Q.ninvoke(request, 'post', {
            url: config.central_stats.central_listener + '/phdata',
            formData: form,
            rejectUnauthorized: false,
        })
        .then(function(httpResponse, body) {
            dbg.log2('Phone Home data sent successfully');
            return;
        })
        .then(null, function(err) {
            dbg.log0('Phone Home data send failed', err, err.stack());
        });

}

function get_empty_nodes_histo() {
    //TODO: Add histogram for limit, once implemented
    var empty_nodes_histo = {};
    empty_nodes_histo.histo_allocation = new histogram('AllocationSizes(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_usage = new histogram('UsedSpace(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_free = new histogram('FreeSpace(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_uptime = new histogram('Uptime(Days)', [{
        label: 'short',
        start_val: 0
    }, {
        label: 'mid',
        start_val: 14
    }, {
        label: 'long',
        start_val: 30
    }]);

    return empty_nodes_histo;
}

/*
 * Background Wokrer
 */
if ((config.central_stats.send_stats !== 'true') &&
    (config.central_stats.central_listener)) {
    dbg.log('Central Statistics gathering enabled');
    promise_utils.run_background_worker({
        name: 'system_server_stats_aggregator',
        batch_size: 1,
        time_since_last_build: 60000, // TODO increase...
        building_timeout: 300000, // TODO increase...
        delay: (60 * 60 * 1000), //60m

        //Run the system statistics gatheting
        run_batch: function() {
            Q.fcall(function() {
                    return get_all_stats({});
                })
                .then(function(payload) {
                    //  return send_stats_payload(payload);
                })
                .then(null, function(err) {

                });
        }
    });
}
