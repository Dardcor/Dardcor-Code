interface History {
	location: string;
	action: string;
	push(path: string): void;
}

export default function PushMissingPathname(history: History) {






	history.push("/home?the=query#the-hash");









	history.push("?another=query#another-hash");

	expect(history.location).toMatchObject({
		pathname: "/home",
		search: "?another=query",
		hash: "#another-hash",
	});
}
