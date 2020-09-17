import { DatabaseDriver } from './database-driver';
import { Log } from './../log';
const os = require("os");
import * as _ from 'lodash';

var Redis = require('ioredis');

export class RedisDatabase implements DatabaseDriver {
    /**
     * Redis client.
     */
    private _redis: any;

    private _serverName: string;

    private _serverList: Array<string>;

    private _checkInterval: number;
    private _checkGuard: number;

    /**
     * Create a new cache instance.
     */
    constructor(private options) {
        this._serverName = (options.databaseConfig.instancePrefix || '') + os.hostname();
        this._checkInterval = options.databaseConfig.checkInterval || 60;
        this._checkGuard = options.databaseConfig.checkGuard || 20;
        this._redis = new Redis(options.databaseConfig.redis);

        if (this.options.devMode) {
            Log.info({ "Redis check interval:": this._checkInterval, "Redis check guard:": this._checkGuard });
        }
        this._serverList = [this._serverName];
        this.pingAlive();
        setInterval(() => {
            this.pingAlive();
        }, this._checkInterval * 1000);

        process.on("exit", () => {
            this._redis.hdel("list:server_list", this._serverName);
        });
    }

    pingAlive(): void {
        const time: number = Date.now();
        this._redis.hset("list:server_list", this._serverName, JSON.stringify({ time, name: this._serverName }));
        this._redis.hvals("list:server_list")
            .catch(e => { Log.error(e); })
            .then(value => {
                value = _.flatten((value || []).map(i => JSON.parse(i)));
                if (this.options.devMode) {
                    Log.info({ "Ping check server:": value });
                }
                this._serverList = value.filter(i => {
                    if (i.time < (time - (this._checkInterval + this._checkGuard) * 1000)) {
                        Log.info({ "Remove server from list:": i });
                        this._redis.hdel("list:server_list", i.name);
                        return false;
                    }
                    return true;
                }).map(i => i.name);
            });
    }

    /**
     * Retrieve data from redis.
     */
    get(key: string): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this._redis.hvals("list:" + key)
                .catch(e => { console.log(e); })
                .then(value => {
                    resolve(_.flatten((value || []).map(i => JSON.parse(i))));
                });
        });
    }

    /**
     * Store data to cache.
     */
    set(key: string, value: any): void {
        this._redis.hset("list:" + key, this._serverName, JSON.stringify(value));
        if (this.options.databaseConfig.publishPresence === true && /^presence-.*:members$/.test(key)) {
            this._redis.publish('PresenceChannelUpdated', JSON.stringify({
                "event": {
                    "channel": key,
                    "members": value
                }
            }));
        }
    }
}
