class ResponseItem
{
  constructor(data) {
    this.name = data.name;
    this.path = data.path;
    this.modifyTime = data.modifyTime;
    this.size = data.size;
    this.type = data.type;
  }
}

class CacheItem {
  constructor(modifyTime, files) {
    this.modifyTime = modifyTime;
    this.files = files;
  }
}

module.exports.ResponseItem = ResponseItem;
module.exports.CacheItem = CacheItem;