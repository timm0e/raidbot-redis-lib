import ioredis = require("ioredis");

export class Sound {
  public id: number;
  public name: string;
  public length: number;
  public file: string;
  public owner: string;

  constructor(
    id: number,
    name: string,
    length: number,
    file: string,
    owner: string,
  ) {
    this.id = id;
    this.name = name;
    this.length = length;
    this.file = file;
    this.owner = owner;
  }
}

export class Category {
  public id: number;
  public name: string;
  public membercount: number;

  constructor(id: number, name: string, membercount: number) {
    this.id = id;
    this.name = name;
    this.membercount = membercount;
  }
}

export class RaidBotDB {
  public readonly RedisClient: ioredis.Redis;
  private readonly PubSubClient: ioredis.Redis;
  private PubSubMap: any;

  constructor(connname: string, database?: number) {
    this.RedisClient = new ioredis({
      connectionName: connname,
      db: database ? database : 0,
      host: process.env.RAIDBOT_REDIS_HOST,
      port: process.env.RAIDBOT_REDIS_PORT
        ? parseInt(process.env.RAIDBOT_REDIS_PORT!, 10)
        : undefined,
    });

    this.PubSubMap = {};

    this.RedisClient.defineCommand("getSounds", {
      lua: `local members = redis.call("SORT", "sounds", "BY", "idlc:*", "ALPHA")
      local soundlist = {}
      for _, key in ipairs(members) do
          local sound = {}
          local objquery = redis.call('HGETALL', 'sounds:' .. key)
          sound['id']=key
          for i=1,#objquery,2 do sound[objquery[i]] = objquery[i+1] end
          table.insert(soundlist, cjson.encode(sound))
      end
      return soundlist`,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("getCategories", {
      lua: `local sort = redis.call('SORT', 'categories', 'BY', 'categories:*:name', 'ALPHA', 'GET', '#')
      local categorylist = {}

      for _, key in ipairs(sort) do
          local category = {}
          category["id"] = key
          category["name"] = redis.call('GET', 'categories:' .. key .. ':name')
          category["membercount"] = redis.call('SCARD', 'categories:' .. key .. ':members')
          table.insert(categorylist, cjson.encode(category))
      end
      return categorylist`,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("getSoundsInCategory", {
      lua: `local sort = redis.call('SORT', 'categories:' .. ARGV[1] .. ':members', 'BY', 'idlc:*', 'ALPHA', 'GET', '#')
    local soundlist = {}

    for _, key in ipairs(sort) do
        local sound = {}
        local objquery = redis.call('HGETALL', 'sounds:' .. key)
        sound['id']=key
        for i=1,#objquery,2 do sound[objquery[i]] = objquery[i+1] end
        table.insert(soundlist, cjson.encode(sound))
    end

    return soundlist
    `,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("getCategoriesForSound", {
      lua: `local soundcategories = redis.call('SMEMBERS', 'sounds:'..ARGV[1]..':categories')
   local categorylist = {}

   for _, key in ipairs(soundcategories) do
       local category = {}
       category["id"] = key
       category["name"] = redis.call('GET', 'categories:' .. key .. ':name')
       category["members"] = redis.call('SCARD', 'categories:' .. key .. ':members')
       table.insert(categorylist, cjson.encode(category))
   end

   return categorylist
   `,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("hashToJson", {
      lua: `local objquery = redis.call('HGETALL', KEYS[1])
   local element = {}
   for i=1,#objquery,2 do element[objquery[i]] = objquery[i+1] end
   return cjson.encode(element)`,
      numberOfKeys: 1,
    });

    this.RedisClient.defineCommand("deleteSound", {
      lua: `local id = ARGV[1]
   local lname = string.lower(redis.call('HGET', 'sounds:'..id, 'name'))
   redis.call('SREM', 'sounds', id)
   redis.call('SREM', 'sounds:nameindex', lname)
   redis.call('DEL', 'idlc:'..id, 'lcid:'..lname)
   for _, category in ipairs(redis.call('SMEMBERS', 'sounds:' .. id .. ':categories')) do
    redis.call('SREM', 'categories:' .. category .. ':members', id)
    local membercount = redis.call('SCARD', 'categories:'..category..':members')

    if membercount == 0 then
        redis.call('SREM', 'categories', category)
        redis.call('DEL', 'categories:' .. category .. ':members', 'categories:' .. category .. ':name')
    end
   end
   redis.call('DEL', 'sounds:' .. id, 'sounds:' .. id .. ':categories')`,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("deleteCategory", {
      lua: `local id = ARGV[1]
   redis.call('SREM', 'categories', id)
   for _, sound in ipairs(redis.call('SMEMBERS', 'sounds')) do
       redis.call('SREM', 'sounds:' .. sound .. ':categories', id)
   end
   redis.call('DEL', 'categories:' .. id .. ':members', 'categories:' .. id .. ':name')`,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("deleteJoinsound", {
      lua: `local id = ARGV[1]
  local set = redis.call('HGETALL', 'joinsounds')
  for i=2,#set,2 do
      if set[i] == id then
          redis.call("HDEL", "joinsounds", set[i-1])
      end
  end`,
      numberOfKeys: 0,
    });

    this.RedisClient.defineCommand("removeSoundFromCategory", {
      lua: `local cat_id = ARGV[1]
      local sound_id = ARGV[2]

      local isMember = redis.call('SISMEMBER', 'categories:'..cat_id..':members', sound_id)
      local membercount = redis.call('SCARD', 'categories:'..cat_id..':members')

      if isMember and membercount == 1 then
          redis.call('SREM', 'categories', cat_id)
          redis.call('DEL', 'categories:' .. cat_id .. ':members', 'categories:' .. cat_id .. ':name')
      else
          redis.call('SREM', 'categories:' .. cat_id .. ':members', sound_id)
      end

      redis.call('SREM', 'sounds:'..sound_id..':categories', cat_id)
      return`,
      numberOfKeys: 0,
    });

    // PUB/SUB

    this.PubSubClient = new ioredis({
      connectionName: connname + "PS",
      host: process.env.RAIDBOT_REDIS_HOST,
      port: process.env.RAIDBOT_REDIS_PORT
        ? parseInt(process.env.RAIDBOT_REDIS_PORT!, 10)
        : undefined,
    });

    this.PubSubClient.on("message", this.handlePubSub);
  }

  public getSounds(): Promise<Sound[]> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).getSounds((err: any, result: string[]) => {
        if (err) {
          reject(err);
          return;
        }
        const sounds = new Array<Sound>();

        try {
          result.forEach(soundString => {
            sounds.push(JSON.parse(soundString));
          });
        } catch (error) {
          reject(error);
        }

        resolve(sounds);
      });
    });
  }

  public getCategories(): Promise<Category[]> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).getCategories((err: any, result: string[]) => {
        if (err) {
          reject(err);
          return;
        }
        const categories = new Array<Category>();

        try {
          result.forEach(categoryString => {
            categories.push(JSON.parse(categoryString));
          });
        } catch (error) {
          reject(error);
        }

        resolve(categories);
      });
    });
  }

  public getSoundsInCategory(categoryid: number): Promise<Sound[]> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).getSoundsInCategory(
        categoryid,
        (err: any, result: string[]) => {
          if (err) {
            reject(err);
          }
          const sounds = new Array<Sound>();

          try {
            result.forEach(soundString => {
              sounds.push(JSON.parse(soundString));
            });
          } catch (error) {
            reject(error);
          }

          resolve(sounds);
        },
      );
    });
  }

  public getCategoriesForSound(soundid: number): Promise<Category[]> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).getCategoriesForSound(
        soundid,
        (err: any, result: string[]) => {
          if (err) {
            reject(err);
            return;
          }
          const categories = new Array<Category>();

          try {
            result.forEach(categoryString => {
              categories.push(JSON.parse(categoryString));
            });
          } catch (error) {
            reject(error);
          }

          resolve(categories);
        },
      );
    });
  }

  public createSound(
    name: string,
    length: number,
    owner: string,
    file: string,
  ): Promise<Sound> {
    return new Promise((resolve, reject) => {
      this.RedisClient.incr("sounds:id").then((id: number) => {
        this.RedisClient.multi()
          .sadd("sounds", id)
          .hmset(
            `sounds:${id}`,
            "name",
            name,
            "length",
            length,
            "file",
            file,
            "owner",
            owner,
          )
          .sadd("sounds:nameindex", name.toLowerCase())
          .set("lcid:" + name.toLowerCase(), id.toString())
          .set("idlc:" + id.toString(), name.toLowerCase())
          .exec()
          .then(() => {
            resolve(new Sound(id, name, length, owner, file));
          });
      });
    });
  }

  public addSoundToCategory(
    soundid: number,
    categoryid: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      Promise.all([
        this.RedisClient.sismember("categories", categoryid),
        this.RedisClient.sismember("sounds", soundid),
      ])
        .then(
          this.RedisClient.multi()
            .sadd(`sounds:${soundid}:categories`, categoryid)
            .sadd(`categories:${categoryid}:members`, soundid)
            .exec(),
        )
        .then(() => {
          resolve();
        });
    });
  }

  public getSoundById(soundid: number): Promise<Sound> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).hashToJson(
        `sounds:${soundid}`,
        (err: any, result: string) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            resolve(JSON.parse(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  public createCategory(name: string): Promise<Category> {
    return new Promise((resolve, reject) => {
      this.RedisClient.incr("categories:id").then((id: number) => {
        return this.RedisClient.multi()
          .sadd("categories", id)
          .set(`categories:${id}:name`, name)
          .exec()
          .then(resolve(new Category(id, name, 0)));
      });
    });
  }

  public deleteSound(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).deleteSound(id, () => {
        (this.RedisClient as any).deleteJoinsound(id, () => {
          resolve();
        });
      });
    });
  }

  public deleteCategory(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any).deleteCategory(id, () => {
        resolve();
      });
    });
  }

  public initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.RedisClient.mset("sounds:id", -1, "categories:id", -1).then(() => {
        resolve();
      });
    });
  }

  public searchSounds(search: string): Promise<Sound[]> {
    return new Promise((resolve, reject) => {
      const searchstring: string =
        "*" + search.toLowerCase().replace(" ", "*") + "*";
      const stream = this.RedisClient.sscanStream("sounds:nameindex", {
        match: searchstring,
      });
      const sounds: Sound[] = [];
      const promises: Array<Promise<any>> = [];

      stream.on("data", (result: any[]) => {
        result.forEach(element => {
          promises.push(
            Promise.resolve(() => this.RedisClient.get("lcid:" + element)).then(
              id =>
                (this.RedisClient as any)
                  .hashToJson(`sounds:${element}`)
                  .then((json: string) => {
                    const sound: Sound = JSON.parse(json);
                    sound.id = element;
                    sounds.push(sound);
                  }),
            ),
          );
        });
      });

      stream.on("end", () => {
        Promise.all(promises).then(() => {
          resolve(sounds);
        });
      });
    });
  }

  public setJoinsound(uid: string, sid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.RedisClient.sismember("sounds", sid)
        .then(() => this.RedisClient.hset("joinsounds", uid, sid))
        .then(resolve)
        .catch(resolve);
    });
  }

  public removeJoinsound(uid: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.RedisClient.hset(uid).then(resolve);
    });
  }

  public getJoinsound(uid: string): Promise<Sound> {
    return new Promise((resolve, reject) => {
      this.RedisClient.hexists("joinsounds", uid)
        .then(() => {
          this.RedisClient.hget("joinsounds", uid).then((soundid: number) => {
            this.getSoundById(soundid).then(resolve);
          });
        })
        .catch(reject);
    });
  }

  public renameSound(sid: number, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.RedisClient.sismember("sounds", sid)
        .then(() => this.getSoundById(sid))
        .then((sound: Sound) => sound.name.toLowerCase())
        .then((oldname: string) =>
          this.RedisClient.multi()
          .hset("sounds:" + sid, "name", name)
            .srem("sounds:nameindex", oldname)
            .sadd("sounds:nameindex", name.toLowerCase())
            .del("lcid:" + oldname)
            .set("lcid:" + name.toLowerCase(), sid)
            .set("idlc:" + sid, name.toLowerCase())
            .exec()
            .then(resolve)
            .catch(reject),
        );
    });
  }

  public removeSoundFromCategory(
    categoryId: number,
    soundId: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      (this.RedisClient as any)
        .removeSoundFromCategory(categoryId, soundId)
        .then(() => resolve());
    });
  }

  public getSoundsNumber(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.RedisClient.scard("sounds").then((num: number) => resolve(num));
    });
  }

  public on(channel: string, callback: (message: any) => any): void {
    const map = this.PubSubMap;
    this.PubSubClient.subscribe(channel).then(() => {
      map[channel] = callback;
    });
  }

  public removeListener(channel: string): void {
    const map = this.PubSubMap;
    this.PubSubClient.unsubscribe(channel).then(() => {
      delete map[channel];
    });
  }

  public send(channel: string, message: any): void {
    this.PubSubClient.publish(channel, JSON.stringify(message));
  }

  private handlePubSub = (channel: string, message: string): void => {
    const handler: (message: string) => any = this.PubSubMap[channel];
    if (handler != null) {
      handler(JSON.parse(message));
    }
  }
}
