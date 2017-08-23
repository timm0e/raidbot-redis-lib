import ioredis = require("ioredis");
const redis: ioredis.Redis = new ioredis({ db: 0 });

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

/**
 * LUA functions
 */

redis.defineCommand("getCategories", {
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
     numberOfKeys : 0,
 });

redis.defineCommand("getSoundsInCategory", {
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

redis.defineCommand("getCategoriesForSound", {
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

export function getCategories(): Promise<Category[]> {
  return new Promise((resolve, reject) => {
    (redis as any).getCategories((err: any, result: string[]) => {
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

export function getSoundsInCategory(categoryid: number): Promise<Sound[]> {
  return new Promise((resolve, reject) => {
    (redis as any).getSoundsInCategory(categoryid, (err: any, result: string[]) => {
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

export function getCategoriesForSound(soundid: number): Promise<Category[]> {
  return new Promise((resolve, reject) => {
      (redis as any).getCategoriesForSound(soundid, (err: any, result: string[]) => {
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
