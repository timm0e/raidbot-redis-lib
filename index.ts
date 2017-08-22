import ioredis = require("ioredis");
const redis: ioredis.Redis = new ioredis({ db: 0 });

class Sound {

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

// tslint:disable-next-line:max-classes-per-file
class Category {

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
   // tslint:disable-next-line:max-line-length
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

function getCategories(callback: (result: Category[]) => void) {
    (redis as any).getCategories((err: any, result: string[]) => {
        const categories = new Array<Category>();

        result.forEach((categoryString) => {
          categories.push(JSON.parse(categoryString));
        });

        callback(categories);
    });
}

function getSoundsInCategory(soundid: number, callback: (result: Sound[]) => void) {
    (redis as any).getSoundsInCategory(soundid, (err: any, result: string[]) => {
        const sounds = new Array<Sound>();

        result.forEach((soundString) => {
          sounds.push(JSON.parse(soundString));
        });

        callback(sounds);
    });
}

module.exports.getCategories = getCategories;
module.exports.getSoundsInCategory = getSoundsInCategory;
