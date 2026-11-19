/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
const name = "John Doe";


function greet(person) {
	return "Hello, " + person + "!";
}


const person = {
	firstName: "John",
	lastName: "Doe",
	fullName: function () {
		return this.firstName + " " + this.lastName;
	}
};


const numbers = [1, 2, 3, 4, 5];


for (let i = 0; i < numbers.length; i++) {
	console.log(numbers[i]);
}


if (name === "John Doe") {
	console.log(greet(name));
} else {
	console.log("Unknown person");
}


switch (name) {
	case "John Doe":
		console.log("Name is John Doe");
		break;
	default:
		console.log("Unknown name");
		break;
}


try {
	console.log(person.fullName());
} catch (error) {
	console.error("An error occurred: " + error.message);
}


const promise = new Promise((resolve, reject) => {
	setTimeout(() => {
		resolve("Promise resolved");
	}, 1000);
});

promise.then((message) => {
	console.log(message);
}).catch((error) => {
	console.error("An error occurred: " + error.message);
});


class Animal {
	constructor(name) {
		this.name = name;
	}

	speak() {
		console.log(this.name + " makes a noise.");
	}
}

class Dog extends Animal {
	speak() {
		console.log(this.name + " barks.");
	}
}

const dog = new Dog("Rex");
dog.speak();
