import ioredis = require("ioredis");

export class Sound {

  public id: number;
  public name: string;
  public length: number;
  public file: string;

  constructor(id: number, name: string, length: number, file: string) {
    this.id = id;
    this.name = name;
    this.length = length;
    this.file = file;
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
  private readonly redis: ioredis.Redis;

  constructor(connname: string, database?: number) {
    this.redis = new ioredis(
      {
        connectionName: connname,
        db: (database) ? database : 0,
      },
    );

    this.redis.defineCommand("getCategories", {
        lua: `local sort = redis.call('SORT', 'categories', 'BY', 'categories:*:name', 'ALPHA', 'GET', '#')
      local categorylist = {}

      for _, key in ipairs(sort) do
          local category = {}
          category["id"] = key
          category["name"] = redis.call('GET', 'categories:' .. key .. ':name')
          category["membercount"] = redis.call('SMEMBERS', 'categories:' .. key .. ':members')[1]
          table.insert(categorylist, cjson.encode(category))
      end
      return categorylist`,
        numberOfKeys: 0,
      });

    this.redis.defineCommand("getSoundsInCategory", {
    lua: `local sort = redis.call('SORT', 'categories:' .. ARGV[1] .. ':members', 'BY', 'sounds:*->name', 'ALPHA', 'GET', '#')
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

    this.redis.defineCommand("getCategoriesForSound", {
   lua: `local soundcategories = redis.call('SMEMBERS', 'sounds:'..ARGV[1]..':categories')
   local categorylist = {}

   for _, key in ipairs(soundcategories) do
       local category = {}
       category["id"] = key
       category["name"] = redis.call('GET', 'categories:' .. key .. ':name')
       category["members"] = redis.call('SMEMBERS', 'categories:' .. key .. ':members')[1]
       table.insert(categorylist, cjson.encode(category))
   end

   return categorylist
   `,
   numberOfKeys: 0,
 });

    this.redis.defineCommand("hashToJson", {
   lua: `local objquery = redis.call('HGETALL', KEYS[1])
   local element = {}
   for i=1,#objquery,2 do element[objquery[i]] = objquery[i+1] end
   return cjson.encode(element)`,
   numberOfKeys: 1,
 });

    this.redis.defineCommand("deleteSound", {
   lua: `local id = ARGV[1]
   redis.call('SREM', 'sounds', id)
   for _, category in ipairs(redis.call('SMEMBERS', 'categories')) do
       redis.call('SREM', 'categories:' .. category .. ':members', id)
   end
   redis.call('DEL', 'sounds:' .. id, 'sounds:' .. id .. ':categories')`,
   numberOfKeys: 0,
 });

    this.redis.defineCommand("deleteCategory", {
   lua: `local id = ARGV[1]
   redis.call('SREM', 'categories', id)
   for _, sound in ipairs(redis.call('SMEMBERS', 'sounds')) do
       redis.call('SREM', 'sounds:' .. sound .. ':categories', id)
   end
   redis.call('DEL', 'categories:' .. id .. ':members', 'categories:' .. id .. ':name')`,
   numberOfKeys: 0,
 });
  }

public getCategories(): Promise<Category[]> {
    return new Promise((resolve, reject) => {
      (this.redis as any).getCategories((err: any, result: string[]) => {
        if (err) {
          reject(err);
          return;
        }
        const categories = new Array<Category>();

        try {
          result.forEach((categoryString) => {
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
      (this.redis as any).getSoundsInCategory(categoryid, (err: any, result: string[]) => {
        if (err) {
          reject(err);
        }
        const sounds = new Array<Sound>();

        try {
          result.forEach((soundString) => {
            sounds.push(JSON.parse(soundString));
          });
        } catch (error) {
          reject(error);
        }

        resolve(sounds);
    });
    });
  }

public getCategoriesForSound(soundid: number): Promise<Category[]> {
    return new Promise((resolve, reject) => {
        (this.redis as any).getCategoriesForSound(soundid, (err: any, result: string[]) => {
          if (err) {
            reject(err);
            return;
          }
          const categories = new Array<Category>();

          try {
            result.forEach((categoryString) => {
              categories.push(JSON.parse(categoryString));
            });
          } catch (error) {
            reject(error);
          }

          resolve(categories);
        });
    });
  }

public createSound(name: string, length: number, file: string): Promise<Sound> {
    return new Promise((resolve, reject) => {
        this.redis.incr("sounds:id").then((id: number) => {
          this.redis.multi().sadd("sounds", id).hmset(`sounds:${id}`, "name", name, "length", length, "file", file).exec().then(() => {
            resolve(new Sound(id, name, length, file));
          });
          });
  });
  }

public addSoundToCategory(soundid: number, categoryid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      Promise.all([this.redis.sismember("categories", categoryid), this.redis.sismember("sounds", soundid)]).then(this.redis.multi().sadd(`sounds:${soundid}:categories`, categoryid).sadd(`categories:${categoryid}:members`, soundid).exec()).then(() => {resolve(); });
    });
  }

public getSoundById(soundid: number): Promise<Sound> {
    return new Promise((resolve, reject) => {
        (this.redis as any).hashToJson(`sounds:${soundid}`, (err: any, result: string) => {
          if (err) {reject(err); return; }

          try {
            resolve(JSON.parse(result));
          } catch (error) {
           reject(error);
          }
        });
    });
  }

public createCategory(name: string): Promise<Category> {
    return new Promise((resolve, reject) => {
        this.redis.incr("categories:id").then((id: number) => {
          return this.redis.multi().sadd("categories", id).set(`categories:${id}:name`, name).exec().then(resolve(new Category(id, name, 0)));
        });
    });
  }

public deleteSound(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
        (this.redis as any).deleteSound(id, () => {resolve(); });
    });
  }

public deleteCategory(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      (this.redis as any).deleteCategory(id, () => {resolve(); });
  });
  }

public initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.redis.mset("sounds:id", 0, "categories:id", 0).then(() => {resolve(); });
    });
  }
}
