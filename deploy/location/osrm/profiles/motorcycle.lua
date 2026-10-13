-- Vietnam-oriented motorcycle profile derived from OSRM's bundled car profile.
-- It keeps motor-vehicle turn restrictions while preferring motorcycle-specific
-- access tags and excluding expressways unless OSM explicitly allows motorcycles.
local car_profile = dofile('/opt/car.lua')

function setup()
  local profile = car_profile.setup()

  profile.properties.max_speed_for_map_matching = 100 / 3.6
  profile.default_speed = 20
  profile.vehicle_height = 1.8
  profile.vehicle_width = 0.9
  profile.vehicle_length = 2.2
  profile.vehicle_weight = 350

  profile.access_tag_whitelist = Set {
    'yes',
    'motorcycle',
    'motor_vehicle',
    'vehicle',
    'permissive',
    'designated'
  }

  profile.access_tags_hierarchy = Sequence {
    'motorcycle',
    'motor_vehicle',
    'vehicle',
    'access'
  }

  profile.restrictions = Sequence {
    'motorcycle',
    'motor_vehicle',
    'vehicle'
  }

  profile.speeds = Sequence {
    highway = {
      trunk           = 50,
      trunk_link      = 35,
      primary         = 45,
      primary_link    = 30,
      secondary       = 40,
      secondary_link  = 25,
      tertiary        = 35,
      tertiary_link   = 22,
      unclassified    = 30,
      residential     = 28,
      living_street   = 15,
      service         = 20,
      track           = 15
    }
  }

  profile.restricted_highway_whitelist = Set {
    'trunk',
    'trunk_link',
    'primary',
    'primary_link',
    'secondary',
    'secondary_link',
    'tertiary',
    'tertiary_link',
    'residential',
    'living_street',
    'unclassified',
    'service',
    'track'
  }

  return profile
end

function process_way(profile, way, result, relations)
  local highway = way:get_value_by_key('highway')
  local motorcycle = way:get_value_by_key('motorcycle')

  if (highway == 'motorway' or highway == 'motorway_link')
      and motorcycle ~= 'yes' and motorcycle ~= 'designated' then
    return
  end

  car_profile.process_way(profile, way, result, relations)
end

return {
  setup = setup,
  process_way = process_way,
  process_node = car_profile.process_node,
  process_turn = car_profile.process_turn
}
