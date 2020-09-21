import { DatabaseDriver } from './database-driver';
import { Log } from './../log';
import { hostname } from 'os';
import * as _ from 'lodash';

var Redis = require('ioredis');

export class RedisDatabase implements DatabaseDriver {
    /**
     * Redis client.
     */
    private _redis: any;

    private _serverName: string;
    private _serverHostName: string;

    private _serverList: Array<string>;

    private _checkInterval: number;
    private _checkGuard: number;

    /**
     * Create a new cache instance.
     */
    constructor(private options) {
        this._serverHostName = hostname();
        this._serverName = (options.databaseConfig.instancePrefix || '') + this._serverHostName + ':' + Date.now();
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
        this._redis.hset("list:server_list", this._serverName, JSON.stringify({ time, name: this._serverName, host: this._serverHostName }));
        this._redis.hvals("list:server_list")
            .catch(e => { Log.error(e); })
            .then(value => {
                value = _.flatten((value || []).map(i => JSON.parse(i)));
                if (this.options.devMode) {
                    Log.info({ "Ping check server:": value });
                }
                this._serverList = value.filter(i => {
                    if (i.host === this._serverHostName && i.name !== this._serverName) {
                        Log.info({ "Remove old instance from list:": i });
                        this._redis.hdel("list:server_list", i.name);
                        return false;
                    }
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
            this._redis.hget("list:" + key, this._serverName)
                .catch(e => { Log.error(e); })
                .then(value => {
                    resolve(JSON.parse(value));
                });
        });
    }

    /**
    * Retrieve data from redis.
    */
    getAll(key: string): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this._redis.hgetall("list:" + key)
                .catch(e => { Log.error(e); })
                .then(values => {
                    Object.keys(values)
                        .filter(i =>
                            this._serverList.indexOf(i) < 0
                        )
                        .forEach(i => {
                            delete values[i];
                            this._redis.hdel("list:" + key, i);
                        });

                    resolve(_.flatten(Object.values(values).map((i: string) => JSON.parse(i))));
                });
        });
    }

    /**
     * Store data to cache.
     */
    set(key: string, value: any): void {
        this._redis.hset("list:" + key, this._serverName, JSON.stringify(value));
    }

    publish(channel: string, value: any): void {
        if (this.options.databaseConfig.publishPresence === true) {
            this._redis.publish((this.options.databaseConfig.redis.keyPrefix || '') + channel, value);
        }
    }
}
