import XCTest

final class Garage: XCTestCase {
    let workshop = XCUIApplication(bundleIdentifier: "com.paulcouach.xk8workshop")
    func press(_ names: [String], contains: Bool = false) throws {
        let predicate = contains ? "label CONTAINS[c] %@" : "label ==[c] %@"
        let matches = names.map { NSPredicate(format: predicate, $0) }
        let element = workshop.descendants(matching: .any).matching(NSCompoundPredicate(orPredicateWithSubpredicates: matches)).firstMatch
        guard element.waitForExistence(timeout: 60) else {
            print("UI tree:", workshop.debugDescription)
            XCTFail("Missing control: \(names)"); throw NSError(domain:"GarageTrial", code:1)
        }
        element.tap()
    }
    func testGarage() throws {
        continueAfterFailure = false
        workshop.launch()
        try press(["Français", "FR"])
        try press(["English", "EN"])
        try press(["Fix it"])
        try press(["Engine oil and filter"], contains: true)
        try press(["Start the job"])
        let done = workshop.descendants(matching:.any).matching(NSPredicate(format:"label == %@", "Step done")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout:20)); done.tap()
        try press(["Next step"])
        try press(["Français", "FR"])
        workshop.terminate()
        workshop.launch()
        try press(["Reprendre"], contains:true)
        XCTAssertTrue(workshop.staticTexts.containing(NSPredicate(format:"label CONTAINS[c] %@", "Ouverture du remplissage")).firstMatch.exists || workshop.debugDescription.contains("Ouverture du remplissage"))
        try press(["English", "EN"])
        try press(["Previous step"])
        XCTAssertEqual(done.value as? String, "1")
        try press(["Next step"])
        try press(["Share PDF"])
        sleep(2)
        print("Native share sheet:", workshop.debugDescription.prefix(5000))
    }
}
