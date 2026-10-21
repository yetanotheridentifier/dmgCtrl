# A cut-down cards-common.coffee in YASB's shape, for generate-xwing-data tests. setupCommonCardData
# copies YASB's XWS id and restricted-list rules, and calls getXWSBaseName as the real one does.
exportObj = exports ? this

String::canonicalize = ->
    this.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '-')

exportObj.basicCardData = ->
    ships:
        "T-65 X-wing":
            name: "T-65 X-wing"
            factions: [ "Rebel Alliance" ]
        "TIE/ln Fighter":
            name: "TIE/ln Fighter"
            factions: [ "Galactic Empire" ]
        "Upsilon-Class Command Shuttle":
            name: "Upsilon-Class Command Shuttle"
            factions: [ "First Order" ]
    pilotsById: [
        {
            name: "Luke Skywalker"
            id: 0
            unique: true
            faction: "Rebel Alliance"
            ship: "T-65 X-wing"
            points: 14
            loadout: 10
        }
        {
            name: "Academy Pilot"
            id: 1
            faction: "Galactic Empire"
            ship: "TIE/ln Fighter"
            points: 5
            loadout: 0
        }
        {
            name: "Old Pilot"
            id: 2
            skip: true
            faction: "Galactic Empire"
            ship: "TIE/ln Fighter"
            points: 3
        }
        {
            name: "Luke Skywalker (BoY)"
            id: 3
            unique: true
            xwsaddon: "battleofyavin"
            faction: "Rebel Alliance"
            ship: "T-65 X-wing"
            points: 15
        }
        {
            name: "Contracted Scout"
            id: 4
            faction: "Galactic Empire"
            ship: "TIE/ln Fighter"
            points: 6
            loadout: 4
        }
        {
            name: "Lieutenant Lappin"
            id: 5
            unique: true
            max_per_squad: 2
            faction: "First Order"
            ship: "Upsilon-Class Command Shuttle"
            points: 12
            loadout: 8
        }
    ]

exportObj.restrictedShips = [
    {name: 'Contracted Scout', limit: 2}
]

exportObj.setupCommonCardData = (basic_cards) ->
    exportObj.pilots = {}
    for pilot_data in basic_cards.pilotsById
        unless pilot_data.skip?
            name_parse = pilot_data.name.split("(")
            pilot_data.canonical_name = name_parse[0].canonicalize() unless pilot_data.canonical_name?
            pilot_data.xws = if pilot_data.xws? then pilot_data.xws else (if pilot_data.xwsaddon? then (pilot_data.canonical_name + "-" + pilot_data.xwsaddon) else (pilot_data.canonical_name + (if name_parse[1]? then ("-" + pilot_data.ship.canonicalize()) else "")))
            exportObj.pilots[pilot_data.name] = pilot_data
            for ship in exportObj.restrictedShips
                if (pilot_data.name == ship.name)
                    pilot_data.restricted = ship.limit
    exportObj.pilotsByUniqueName = {}
    for name, pilot of exportObj.pilots
        if pilot.unique?
            (exportObj.pilotsByUniqueName[pilot.canonical_name.getXWSBaseName()] ?= []).push pilot
