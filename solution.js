{
    DIR_UP: "up", 
    DIR_DOWN: "down",
    FULL_LOAD: 0.8,

    elevators: [],
    floors: [],
    bottomFloor: 0,
    topFloor: 0,
    upFloorCalls: [],
    downFloorCalls: [],
    onlineCars: 1,
    carLoadHistory: [],

    updateIndicator: function(elevator) {
        var currentFloor = elevator.currentFloor();
        var currentDestination = elevator.currentDestination;
        var currentDirection = false;
        if (currentFloor < currentDestination) {
            currentDirection = this.DIR_UP;
        } else if (currentFloor > currentDestination) {
            currentDirection = this.DIR_DOWN;
        }

        if (currentFloor === this.bottomFloor) {
            currentDirection = this.DIR_UP;
        } else if (currentFloor === this.topFloor) {
            currentDirection = this.DIR_DOWN;
        }

        if (currentDirection === this.DIR_UP) {
            elevator.goingUpIndicator(true);
            elevator.goingDownIndicator(false);
        } else if (currentDirection === this.DIR_DOWN) {
            elevator.goingUpIndicator(false);
            elevator.goingDownIndicator(true);
        } else {
            elevator.goingUpIndicator(false);
            elevator.goingDownIndicator(false);
        }
    },

    setDirection: function(elevator, direction) {
        if (elevator.currentDirection === direction) {
            return;
        }
        
        elevator.currentDirection = direction;
    },

    getDirection: function(elevator) {
        return elevator.currentDirection;
    },

    findNextInQueue: function(current, direction, queue) {
        // filter the queue to only values in the current direction
        var ahead = queue.filter(function (direction, elem) {
            if (direction === this.DIR_UP) {
                return elem >= current;
            } else {
                return elem <= current;
            }
        }.bind(this, direction));

        ahead = ahead.sort();
        if (direction === this.DIR_DOWN) {
            ahead = ahead.reverse();
        }

        return ahead.length > 0 ? ahead[0] : -1;
    },

    /**
     * Adds a value to an array exactly once
     */
    addValueToQueue: function(queue, value) {
        if (queue.indexOf(value) !== -1) {
            return queue;
        }

        queue[queue.length] = value;

        return queue;
    },

    removeValueFromQueue: function(queue, value) {
        return queue.filter(function (elem) {
            return elem !== value;
        });
    },

    evalBestStopAlongTrajectory: function(elevator, currentFloor, currentDirection) {
        this.debug("Evaluating best stop along trajectory...");

        this.debug("Current direction is "+currentDirection+" and current floor is " + currentFloor + ".");
        this.debug("Pending rider calls: "+JSON.stringify(elevator.riderCalls));
        this.debug("Pending up floor calls: "+JSON.stringify(this.upFloorCalls));
        this.debug("Pending down floor calls: "+JSON.stringify(this.downFloorCalls));

        // Find nearest rider call, will be -1 if none
        var nearestRiderCall = this.findNextInQueue(currentFloor, currentDirection, elevator.riderCalls);
        this.debug("Nearest rider call: "+nearestRiderCall);
        
        // Find the nearest floor call in current direction that isn't the destination for other cars going same direction
        var otherCarsThisDirection = this.elevators.filter(function (other) {
            return other.currentDirection === currentDirection;
        });
        var otherFloorDestinations = [];
        for (var i = 0; i < otherCarsThisDirection.length; i++) {
            otherFloorDestinations[otherFloorDestinations.length] = otherCarsThisDirection[i].currentDestination;
        }
        var floorCalls = currentDirection === this.DIR_UP ? this.upFloorCalls : this.downFloorCalls;
        // Filter out floors being attended by other cars
        floorCalls = floorCalls.filter(function(elem) {
            return otherFloorDestinations.indexOf(elem) === -1;
        });
        var nearestFloorCall = this.findNextInQueue(currentFloor, currentDirection, floorCalls);
        this.debug("Nearest floor call: "+nearestFloorCall);

        var isFull = elevator.loadFactor() > this.FULL_LOAD;
        if (isFull || !this.elevatorIsOnline(elevator)) {
            this.debug("Car is full or offline.");
            nearestFloorCall = -1;
        }


        if (nearestRiderCall === -1 && nearestFloorCall === -1) {
            this.debug("No calls in current direction.");
            // No calls in current direction

            if (isFull || !this.elevatorIsOnline(elevator)) {
                return -1;
            }

            // First check for floor calls ahead that want to go the other direction, if so, we want to grab the furthest.
            var reverseFloorCalls = currentDirection === this.DIR_UP ? this.downFloorCalls : this.upFloorCalls;
            var reverseDirection = currentDirection === this.DIR_UP ? this.DIR_DOWN : this.DIR_UP;
            var ultimateFloor = currentDirection === this.DIR_UP ? this.topFloor : this.bottomFloor;
            var furthestReverseFloorCall = this.findNextInQueue(ultimateFloor, reverseDirection, reverseFloorCalls);
            this.debug("Nearest floor call that wants to go back: "+furthestReverseFloorCall);
            if (furthestReverseFloorCall !== -1) {
                this.debug("Going to reverse call.");
                return furthestReverseFloorCall;
            }

            // There is nothing good on this trajectory
            return -1;
        } else if (nearestRiderCall === -1) {
            this.debug("Heading to nearest floor call: "+nearestFloorCall);
            // There is a floor call ahead but no rider calls
            return nearestFloorCall;
        } else if (nearestFloorCall === -1) {
            this.debug("Heading to nearest rider call: "+nearestRiderCall);
            // There is a rider call ahead but no floor calls
            return nearestRiderCall;
        } else {
            this.debug("Deciding between floor call: "+nearestFloorCall+" and rider call: "+nearestRiderCall);
            // There are both floor and rider calls ahead
            if (currentDirection === this.DIR_UP) {
                return Math.min(nearestFloorCall, nearestRiderCall);
            } else {
                return Math.max(nearestFloorCall, nearestRiderCall);
            }
        }
    },

    evalNextStop: function(elevator) {
        // Optimal strategy: 
        // 1. Continue in the current direction
        // 2. Pickup anyone heading in this direction along the way, unless the load is near-full.
        // 3. Drop off anyone onboard as we pass their floor
        // 4. If there are no more calls in the current direction, turn around.
        // 4a. Before turning around, check for floor calls in reverse direction that might be ahead
        // 5. If there are no more calls anywhere, return to home floor

        this.debug("Evaluating next stop...");

        // Quickly check that there are any call anywhere. If not, go home.
        if (elevator.riderCalls.length === 0 && this.upFloorCalls.length === 0 && this.downFloorCalls.length === 0) {
            this.debug("No calls, heading home (" + elevator.homeFloor + ").");
            return elevator.homeFloor;
        }

        var currentDirection = this.getDirection(elevator);
        var currentFloor = elevator.currentFloor();

        var bestFloorAhead = this.evalBestStopAlongTrajectory(elevator, currentFloor, currentDirection);
        this.debug("Best floor ahead: "+bestFloorAhead);
        if (bestFloorAhead === -1) {
            // If nothing good ahead, turn around
            var reverseDirection = currentDirection === this.DIR_UP ? this.DIR_DOWN : this.DIR_UP;
            var bestFloorBehind = this.evalBestStopAlongTrajectory(elevator, currentFloor, reverseDirection);

            if (bestFloorBehind === -1) {
                // If nothing at all (this case shouldn't actually be possible), go home
                this.debug("Going home.");
                return elevator.homeFloor;
            }

            return bestFloorBehind;
        }
        return bestFloorAhead;
    },

    elevatorIsOnline: function(elevator) {
        return true;
        // var elevIdx = this.elevators.indexOf(elevator);
        // return elevIdx < this.onlineCars;
    },

    updateNextFloor: function(elevator) {

        var nextFloor = this.evalNextStop(elevator);

        this.debug("Going to floor: "+nextFloor);

        if (!this.elevatorIsOnline(elevator)) {
            return;
        }

        this.goToFloor(elevator, nextFloor);
        this.updateIndicator(elevator);
    },

    rebalanceDelay: 0,
    balanceLoad: function() {
        return;

        this.debug("Online cars: "+this.onlineCars);
        // Only rebalance once every 10 calls
        this.rebalanceDelay++;
        if (this.rebalanceDelay < 10) {
            return;
        }
        this.rebalanceDelay = 0;

        // Truncate history to most recent X measures
        var MAX_HISTORY = 10;
        var truncated = this.carLoadHistory;
        if (truncated.length > MAX_HISTORY) {
            truncated.reverse();
            truncated.length = MAX_HISTORY;
            truncated.reverse();
        }
        this.carLoadHistory = truncated;

        // Compute the average car load
        var sum = 0;
        for (var i = 0; i < truncated.length; i++) {
            sum += truncated[i];
        }
        var average = sum / truncated.length;
        this.debug("Average car load: "+average);

        // Adjust online cars as necessary
        if (average > 0.5 && this.onlineCars < this.elevators.length - 1) {
            this.onlineCars++;
            // Reset history
            this.carLoadHistory = [];
            this.updateNextFloor(this.elevators[this.onlineCars - 1]);
        } else if (average < 0.2 && this.onlineCars > 1) {
            this.onlineCars--;
            // Reset history
            this.carLoadHistory = [];
        }
    },

    elevatorIdle: function(elevator) {
        this.debug("Elevator is idle.");

        // Where do we go next?
        this.updateNextFloor(elevator);
    },

    elevatorFloorButtonPressed: function(elevator, floorNum) {
        this.debug("Elevator floor button pressed.");

        // Add floor to elevator's list of rider calls
        elevator.riderCalls = this.addValueToQueue(elevator.riderCalls, floorNum);
    },

    elevatorPassingFloor: function(elevator, floorNum, direction) {
        this.debug("Elevator passing floor.");

        // Track current load
        this.carLoadHistory[this.carLoadHistory.length] = elevator.loadFactor();

        // Quickly reevaluate next destination
        // this.updateNextFloor(elevator);
    },

    elevatorStoppedAtFloor: function(elevator, floorNum) {
        this.debug("Elevator stopped at floor.");

        // Track current load
        this.carLoadHistory[this.carLoadHistory.length] = elevator.loadFactor();
        this.debug("Car load is: "+elevator.loadFactor());
        this.balanceLoad();

        // Remove the current floor from rider calls
        elevator.riderCalls = this.removeValueFromQueue(elevator.riderCalls, floorNum);

        // Remove current floor from floor calls in current direction
        if(this.getDirection(elevator) === this.DIR_UP) {
            this.upFloorCalls = this.removeValueFromQueue(this.upFloorCalls, floorNum);
        } else {
            this.downFloorCalls = this.removeValueFromQueue(this.downFloorCalls, floorNum);
        }

        // If top or bottom floor, also remove floor calls in opposite direction
        if(floorNum === this.topFloor || floorNum === this.bottomFloor) {
            if(this.getDirection(elevator) === this.DIR_UP) {
                this.downFloorCalls = this.removeValueFromQueue(this.downFloorCalls, floorNum);
            } else {
                this.upFloorCalls = this.removeValueFromQueue(this.upFloorCalls, floorNum);
            }
        }

        // Quickly reevaluate next destination
        this.updateNextFloor(elevator);
    },

    goToFloor: function(elevator, floorNum) {
        // Ignore if the specified floor is at the head of the current destination queue
        // if (elevator.currentDestination === floorNum) {
        //     return;
        // }

        // Hard-set destination without any regard for existing destination
        elevator.destinationQueue = [floorNum];
        elevator.checkDestinationQueue();

        // Track our current destination
        elevator.currentDestination = floorNum;

        // Change direction if necessary
        var curFloor = elevator.currentFloor();
        if (curFloor < floorNum) {
            this.setDirection(elevator, this.DIR_UP);
        } else {
            this.setDirection(elevator, this.DIR_DOWN);
        }
    },

    floorCall: function(floor, direction) {
        this.debug("Floor button pressed.");

        var floorNum = floor.floorNum();
        if (direction === this.DIR_UP) {
            this.upFloorCalls = this.addValueToQueue(this.upFloorCalls, floorNum);
        } else {
            this.downFloorCalls = this.addValueToQueue(this.downFloorCalls, floorNum);
        }
    },
    
    init: function(elevators, floors) {
        this.elevators = elevators;
        this.floors = floors;

        var floorNums = [];
        for (var floorIdx = 0; floorIdx < floors.length; floorIdx++) {
            var floor = floors[floorIdx];

            // Grab specific floor numbers for home floor computation
            floorNums[floorNums.length] = floor.floorNum();

            // Attach call handlers
            floor.on("up_button_pressed", this.floorCall.bind(this, floor, this.DIR_UP));
            floor.on("down_button_pressed", this.floorCall.bind(this, floor, this.DIR_DOWN));
        }
        floorNums.sort();
        this.bottomFloor = floorNums[0];
        this.topFloor = floorNums[floorNums.length - 1];
        var idealSplit = Math.floor((this.topFloor - this.bottomFloor) / (elevators.length + 1));

        for (var elevIdx = 0; elevIdx < elevators.length; elevIdx++) {
            var elevator = elevators[elevIdx];

            // Calculate home floor by finding total spread of floors and then distributing evenly between elevators.
            elevator.homeFloor = idealSplit * (elevIdx + 1);

            var randomFloor = Math.floor((this.topFloor - this.bottomFloor) * Math.random()) + this.bottomFloor;

            // Initialise our custom elevator properties
            elevator.riderCalls = [];
            // this.setDirection(elevator, this.DIR_UP);
            // elevator.currentDestination = elevator.currentFloor();

            // Attach to our idle handler.
            elevator.on("idle", this.elevatorIdle.bind(this, elevator));

            // Attach to our floor_button_pressed handler.
            elevator.on("floor_button_pressed", this.elevatorFloorButtonPressed.bind(this, elevator));
            
            // Attach to our passing_floor handler.
            elevator.on("passing_floor", this.elevatorPassingFloor.bind(this, elevator));

            // Attach to our stopped_at_floor handler.
            elevator.on("stopped_at_floor", this.elevatorStoppedAtFloor.bind(this, elevator));
        }
        
        

    },
    update: function(dt, elevators, floors) {
        // We normally don't need to do anything here
    },
    debug: function(line) {
        console.log("DEBUG: "+line);
    }
}