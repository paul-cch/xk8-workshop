import XCTest

final class TouchWorkshop: XCTestCase {
    let workshop = XCUIApplication(bundleIdentifier: "com.paulcouach.xk8workshop")
    func button(_ label: String) -> XCUIElement {
        workshop.buttons.matching(NSPredicate(format: "label == %@",label)).firstMatch
    }
    func labelled(_ label: String) -> XCUIElement {
        workshop.descendants(matching:.any).matching(NSPredicate(format:"label == %@",label)).firstMatch
    }
    func testTouchWorkshop() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        workshop.launch()
        if button("Réglages").waitForExistence(timeout:4) { labelled("English").tap() }
        let french = labelled("Français")
        XCTAssertTrue(french.waitForExistence(timeout:75))
        for element in [french, labelled("English"), button("Settings"), button("Search everything")] {
            XCTAssertGreaterThanOrEqual(element.frame.width,48)
            XCTAssertGreaterThanOrEqual(element.frame.height,48)
        }
        french.tap()
        let fix = button("Réparer"); XCTAssertTrue(fix.waitForExistence(timeout:15)); fix.tap()
        let grip=workshop.buttons.matching(NSPredicate(format:"label BEGINSWITH %@", "Hauteur du panneau")).firstMatch
        XCTAssertTrue(grip.waitForExistence(timeout:15))
        let settings=button("Réglages")
        XCTAssertLessThan(grip.frame.minY-settings.frame.maxY,16)
        let settingsTop=settings.frame.minY
        let search=button("Tout rechercher");search.tap()
        let close=button("Fermer");XCTAssertTrue(close.waitForExistence(timeout:15))
        XCTAssertGreaterThanOrEqual(close.frame.minY,settingsTop-4)
        workshop.typeText("P0340")
        let hit=workshop.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS[c] %@ AND label CONTAINS[c] %@", "P0340", "code")).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout:12),workshop.debugDescription.suffix(8000).description)
        close.tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        let upkeep=button("Entretien");XCTAssertTrue(upkeep.waitForExistence(timeout:12))
        XCTAssertGreaterThanOrEqual(upkeep.frame.minX,workshop.frame.width/2-30)
        XCTAssertGreaterThanOrEqual(upkeep.frame.minY,workshop.frame.height/2)
        XCTAssertGreaterThanOrEqual(upkeep.frame.height,48)
        XCTAssertLessThanOrEqual(button("Réglages").frame.maxX,workshop.frame.width)
        upkeep.tap()
        XCUIDevice.shared.orientation = .portrait
        labelled("English").tap()
        button("The car").tap()
        let next=button("Fix it");XCTAssertTrue(next.exists)
    }
}
