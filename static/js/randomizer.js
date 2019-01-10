(function() {
    'use strict'
    
    let dominion;
    $(window).on('load', function() {
        let mainForm = document.getElementById('randomize')
        FormPersistence.persist(mainForm)
        loadDominionData().then(_ => {
            // need to ensure dominion data is loaded before populating form
            FormPersistence.load(mainForm, false, {
                's': (_, value) => addGameSet(value),
                'i': (_, value) => addFilteredCard(value, true),
                'x': (_, value) => addFilteredCard(value, false)
            })
        })
        $('#set-select').on('change', doAddGameSet)
        $('input[name="mode"]').on('click', updateDistributionVisibility)
        $('#include button').on('click', doAddFilteredCard)
        $('#exclude button').on('click', doAddFilteredCard)
        //$('fieldset:not(#sets) :not(legend)').hide()
        $('fieldset:not(#sets) legend').on('click', toggleFieldset)
        $('#randomize').on('submit', submitForm)
    })
    
    function loadDominionData() {
        return fetch('static/dominion.json')
            .then(response => response.json())
            .then(json => {
                dominion = json
                dominion.allCards = []
                // build inclusion/exclusion options
                let options = []
                let include = $('#include-randomizers')
                let exclude = $('#exclude-randomizers')
                $.each(dominion.cards, (set, cards) => {
                    $.each(cards, (_, card) => {
                        card.set = set
                        dominion.allCards.push(card)
                        // skip duplicate entries on multi-edition sets
                        if (!options.includes(card.name)) {
                            $('<option>').val(card.name).appendTo(include)
                            $('<option>').val(card.name).appendTo(exclude)
                            options.push(card.name)
                        }
                    })
                })
                // build set selection options
                let select = $('#set-select')
                $.each(dominion.sets, (_, set) => {
                    if (set === 'Promo') {
                        let group = $('<optgroup>').attr('label', set).appendTo(select)
                        $.each(dominion.cards[set], (_, card) => {
                            $('<option>').val(card.name).text(card.name).appendTo(group)
                        })
                    } else {
                        $('<option>').val(set).text(set).appendTo(select)
                    }
                })
                // build type filter checkbox options
                let typeDiv = $('#types')
                $.each(dominion.types, (_, type) => {
                    let label = $('<label>').text(' ' + type).appendTo(typeDiv)
                    $('<input>').attr('type', 'checkbox').attr('name', 'f').val(type).prependTo(label)
                })
            })
    }
    
    // via https://stackoverflow.com/a/11935263/1247781
    function getRandomSample(arr, size) {
        let shuffled = arr.slice(0), i = arr.length, min = i - size, temp, index
        while (i-- > min) {
            index = Math.floor((i + 1) * Math.random())
            temp = shuffled[index]
            shuffled[index] = shuffled[i]
            shuffled[i] = temp
        }
        return shuffled.slice(min)
    }
    
    // roulette wheel selection
    function getWeightedSample(arr, weights, size) {
        let sample = []
        let currArr = arr.slice(0), currWeights = cumulativeSum(weights)
        while (size-- > 0) {
            let pick = currWeights[currWeights.length - 1] * Math.random()
            for (let i = 0, found = false; i < currArr.length && !found; i++) {
                if (pick < currWeights[i]) {
                    sample.push(currArr[i])
                    let pickedWeight = i > 0 ? currWeights[i] - currWeights[i - 1] : currWeights[i]
                    currArr.splice(i, 1)
                    currWeights.splice(i, 1)
                    for (let j = i; j < currWeights.length; j++) {
                        if (i <= j) {
                            currWeights[j] -= pickedWeight
                        }
                    }
                    found = true
                }
            }
        }
        return sample
    }
    
    // via https://stackoverflow.com/a/20477613/1247781
    function cumulativeSum(arr) {
        let cumulative = []
        arr.reduce((a, b, i) => cumulative[i] = a + b, 0)
        return cumulative
    }

    function submitForm() {
        if (checkForm()) {
            randomize()
        }
        return false  // stay on the current page
    }

    function checkForm() {
        return true
    }

    // TODO: clean this up
    function randomize() {
        let data = new FormData($('#randomize')[0])
        let cards = []

        let count = Number(data.get('n'))
        let eventCount = Number(data.get('e'))
        let landmarkCount = Number(data.get('l'))
        let projectCount = Number(data.get('p'))
        let sets = data.getAll('s')
        let counts = data.has('c') ? data.getAll('c').map(c => Number(c)) : []
        let exclusions = data.has('x') ? data.getAll('x') : []
        let filterTypes = data.has('f') ? data.getAll('f') : []
        if (data.has('i')) {
            data.getAll('i').forEach(cardName => {
                let card = dominion.allCards.find(c => c.name === cardName)
                cards.push(card)
                count--
                if (counts.length > 0) {
                    counts[sets.indexOf(card.set)]--
                }
            })
        }
        let promoCards = []
        let completeSets = sets.filter(set => {
            if (set.endsWith('*')) {
                promoCards.push(set.substring(0, set.length - 1))
                return false
            }
            return true
        })

        let canPickCard = (card) => (completeSets.includes(card.set) || promoCards.includes(card.name)) &&
            !exclusions.includes(card.name) && !cards.includes(card) &&
            !filterTypes.some(t => card.types.includes(t))

        let mode = data.get('mode')
        if (mode === 'counts') {
            sets.forEach((set, i) => {
                let possibleSetCards = dominion.cards[set].filter(canPickCard)
                cards.push(...getRandomSample(possibleSetCards, counts[i]))
            })
        } else {
            let possibleCards = Array.from(new Set(dominion.allCards.filter(canPickCard)))
            if (mode === 'standard') {
                cards.push(...getRandomSample(possibleCards, count))
            } else if (mode === 'weights') {
                let setWeights = data.getAll('w').map(w => Number(w))
                let weights = possibleCards.map(card => {
                    for (let i = 0; i < sets.length; i++) {
                        // handle promo cards (e.g. named Black Market*)
                        if (sets[i] === card.set || sets[i].startsWith(card.name)) {
                            return setWeights[i]
                        }
                    }
                    return 0
                })
                cards.push(...getWeightedSample(possibleCards, weights, count))
            }
        }

        // replace the last non-Looter card with Ruins
        if (cards.some(card => card.types.includes('Looter'))) {
            let replaced = false
            for (let i = cards.length - 1; i >= 0 && !replaced; i--) {
                if (!cards[i].types.includes('Looter')) {
                    cards[i] = {'name': 'Survivors', 'set': 'Dark Ages', 'types': ['Action', 'Ruins']}
                    replaced = true
                }
            }
        }

        let getNonCards = (cardSets, count) => {
            let possibles = []
            Object.keys(cardSets).forEach(set => {
                if (sets.includes(set)) {
                    possibles.push(...cardSets[set])
                }
            })
            return getRandomSample(possibles, count)
        }
        let events = getNonCards(dominion.events, eventCount)
        let landmarks = getNonCards(dominion.landmarks, landmarkCount)
        let projects = getNonCards(dominion.projects, projectCount)

        cards.sort((c1, c2) => {
            if (c1.set === c2.set) {
                return c1.name.localeCompare(c2.name)
            } else {
                return sets.indexOf(c1.set) - sets.indexOf(c2.set)
            }
        })
        let cardsDiv = $('#cards').empty()
        let eventsDiv = $('#events').empty()
        let landmarksDiv = $('#landmarks').empty()
        let projectsDiv = $('#projects').empty()
        cards.forEach(card => addCard(card.name, cardsDiv))
        events.forEach(card => addCard(card, eventsDiv))
        landmarks.forEach(card => addCard(card, landmarksDiv))
        projects.forEach(card => addCard(card, projectsDiv))
    }

    function addCard(cardName, container) {
        let card = $('<img>')
        let encodedName = cardName.replace(/ /g, '_').replace('/', '_').replace(/'/g, '%27')
        card.attr('src', encodeURI('static/cards/' + encodedName + '.jpg'))
        card.attr('alt', cardName)
        container.append(card)
    }

    function doAddGameSet() {
        let select = $('#set-select')
        let selected = select.find('option[value]:selected') 
        if (selected.length > 0) {
            addGameSet(selected.text())
        }
    }

    function addGameSet(set) {
        if ($('input[name="s"][value="' + set + '"]').length == 0) {
            let mode = $('input[name="mode"]:checked').val()
            let setDiv = $('<div>').addClass('set')
            
            if (dominion.cards['Promo'].some(card => card.name === set)) {
                set += '*'
            }
            let setLabel = $('<span>').text(set)
            setDiv.append(setLabel)
    
            let setInput = $('<input>').attr('name', 's').attr('type', 'hidden').val(set)
            setDiv.append(setInput)
    
            let setCount = buildDistributionInput('Count', 'c', mode == 'counts')
            setDiv.append(setCount)
            let setWeight = buildDistributionInput('Weight', 'w', mode == 'weights')
            setDiv.append(setWeight)
    
            let spacer = $('<div>').addClass('spacer')
            setDiv.append(spacer)
    
            addRemoveButton(setDiv)
            $('#sets').append(setDiv)
        }
    }

    function buildDistributionInput(labelName, name, enabled) {
        let label = $('<label>').text(labelName + ' ')

        let input = $('<input>').attr('name', name).attr('type', 'number').attr('min', 0)
        label.append(input)

        enable(label, enabled)
        return label
    }

    function addRemoveButton(parentDiv) {
        let button = $('<button>').attr('type', 'button').text('Remove').on('click', () => parentDiv.remove())
        parentDiv.append(button)
    }

    function doAddFilteredCard() {
        let fieldset = $(this).parent().parent()
        let inputElem = fieldset.find('input[list]')
        let input = inputElem.val()
        if (input) {
            let isInclude = fieldset.attr('id') == 'include'
            addFilteredCard(input, isInclude)
            inputElem.val('')
        }
    }

    function addFilteredCard(value, isInclude) {
        let fieldset = $('#' + (isInclude ? 'include' : 'exclude'))
        let key = isInclude ? 'i' : 'x'
        if (fieldset.find('input[name="' + key + '"][value="' + value + '"]').length == 0) {
            let cardDiv = $('<div>').addClass('filtered-card')

            let cardLabel = $('<span>').text(value)
            cardDiv.append(cardLabel)

            let cardInput = $('<input>').attr('name', key).attr('type', 'hidden').val(value)
            cardDiv.append(cardInput)

            addRemoveButton(cardDiv)
            fieldset.append(cardDiv)
        }
    }

    function updateDistributionVisibility() {
        let counts = $('input[name="c"]').parent()
        let weights = $('input[name="w"]').parent()
        if (this.value == 'standard') {
            enable(counts, false)
            enable(weights, false)
        } else if (this.value == 'counts') {
            enable(weights, false)
            enable(counts, true)
        } else if (this.value == 'weights') {
            enable(counts, false)
            enable(weights, true)
        }
    }

    function enable(labelInput, enabled) {
        if (enabled) {
            labelInput.show()
            labelInput.find('input').attr('disabled', false)
        } else {
            labelInput.hide()
            labelInput.find('input').attr('disabled', true)
        }
    }

    function toggleFieldset() {
        $(this).parent().find(':not(legend):not(datalist)').slideToggle()
        // TODO: add arrow that flips to indicate action
    }
})()
